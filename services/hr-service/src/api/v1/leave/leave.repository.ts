// ─────────────────────────────────────────────────────────────────────────────
// Leave repository — all DB access for the leave module.
//
// Conventions (following services/hr-service/src/api/v1/employees):
//   - Reads that only touch the caller's own rows go through withRoleTx so the
//     hr.* RLS policies scope them.
//   - Writes that append to hr.leave_ledger / hr.leave_request_status_log run in
//     the SERVICE transaction (root_service, BYPASSRLS) because those tables are
//     INSERT-only via the service path by design (db_scripts/11). Authorization
//     is enforced in the service layer; every query is still explicitly scoped
//     by the gateway-verified org_id / user_id — never a client-supplied id.
//   - In-transaction validations mirror employees.repository (ConflictError etc.
//     thrown inside the tx) so the whole write stays atomic.
//   - Multi-table reads use parameterized SQL joins via tx.execute, matching the
//     established employees.repository pattern (this service does not use Drizzle
//     views).
//
// Ledger sign convention (documented once, enforced everywhere):
//   accrual > 0, carry_forward > 0, consumption < 0, lapse < 0, encashment < 0,
//   adjustment either sign. Balance = SUM(amount).
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, pgErrorCode, type RoleTxContext, type DrizzleTx } from '@platform/db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import { computeLeaveDays, type HalfDay } from '../../../lib/leave/compute-leave-days.js';
import { resolveApprovers } from '../../../lib/leave/resolve-approvers.js';
import { resolveEffectivePolicy, resolveCycleStartMonth } from '../../../lib/leave/policy.js';
import type {
  ApplyLeaveRequestInput,
  UpdateLeaveRequestInput,
  PreviewLeaveRequestInput,
  ListLeaveRequestsInput,
  ListBalancesInput,
  CreateAdjustmentInput,
  CreatePolicyInput,
  UpdatePolicyInput,
  ListPoliciesInput,
  ListHolidaysInput,
  CreateHolidayInput,
  UpdateHolidayInput,
  CreateHolidayCalendarInput,
  UpdateHolidayCalendarInput,
} from '@hr/validation';

// `capabilities` (Tier C3) rides along so the service-layer gates can ask the
// DB-resolved matrix instead of comparing ranks.
export type LeaveCtx = RoleTxContext & { rank: number; capabilities: string[] };

type Row = Record<string, unknown>;

// ── Service-tx helper: sets the session GUCs the hr.* triggers read ──────────
async function serviceTxWithContext<T>(
  ctx: RoleTxContext,
  note: string | null,
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return withServiceTx(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`);
    if (note !== null) {
      await tx.execute(sql`SELECT set_config('app.leave_transition_note', ${note}, true)`);
    }
    return fn(tx);
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Small lookups ─────────────────────────────────────────────────────────────
// tenantId is required: several callers run in the SERVICE transaction
// (BYPASSRLS), so hr.leave_types' tenant_isolation_policy does not filter rows
// there — the query must scope explicitly or it can match another tenant's
// same-named row (db_scripts/22 made this table tenant-scoped).
async function resolveLeaveType(tx: DrizzleTx, tenantId: string, name: string): Promise<{ id: string; name: string; is_paid: boolean }> {
  const rows = (await tx.execute(sql`
    SELECT id::text, name, is_paid FROM hr.leave_types WHERE tenant_id = ${tenantId} AND name = ${name} AND is_active
  `)) as unknown as Array<{ id: string; name: string; is_paid: boolean }>;
  if (!rows[0]) throw new BadRequestError(`Unknown or inactive leave type: ${name}`);
  return rows[0];
}

// hr.leave_request_statuses is tenant-scoped as of 1.26.0, like leave_types
// above — every tenant has its own row named 'pending'. Without the tenant
// filter this ran under a service tx (BYPASSRLS) and would take rows[0] from
// whichever tenant the planner happened to return first, stamping a leave
// request with another tenant's status id.
async function resolveStatusId(tx: DrizzleTx, tenantId: string, name: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT id::text FROM hr.leave_request_statuses WHERE tenant_id = ${tenantId} AND name = ${name}
  `)) as unknown as Array<{ id: string }>;
  if (!rows[0]) throw new BadRequestError(`Unknown leave request status: ${name}`);
  return rows[0].id;
}

async function orgHolidaysBetween(
  tx: DrizzleTx,
  orgId: string,
  start: string,
  end: string,
): Promise<string[]> {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT holiday_date::text AS d
    FROM hr.holidays
    WHERE org_id = ${orgId}
      AND is_active AND NOT is_deleted
      AND NOT is_optional
      AND holiday_date BETWEEN ${start} AND ${end}
  `)) as unknown as Array<{ d: string }>;
  return rows.map((r) => r.d);
}

async function weeklyOffPattern(tx: DrizzleTx, orgId: string, userId: string): Promise<number[]> {
  const rows = (await tx.execute(sql`
    SELECT weekly_off_pattern AS p
    FROM hr.employee_profiles
    WHERE user_id = ${userId} AND org_id = ${orgId} AND NOT is_deleted
  `)) as unknown as Array<{ p: number[] }>;
  return rows[0]?.p ?? [0, 6];
}

async function currentBalance(tx: DrizzleTx, orgId: string, userId: string, leaveTypeId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::float8 AS bal
    FROM hr.leave_ledger
    WHERE user_id = ${userId} AND org_id = ${orgId} AND leave_type_id = ${leaveTypeId}
  `)) as unknown as Array<{ bal: number }>;
  return rows[0]?.bal ?? 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// APPLY
// ═════════════════════════════════════════════════════════════════════════════
export interface ApplyResult {
  id: string;
  days_count: number;
  level1_approver_id: string | null;
}

/**
 * Every rule a submitted request must satisfy, and the server-computed values
 * that fall out of checking them.
 *
 * Shared by applyLeave and updateLeaveRequest so an amended request is held to
 * exactly the rules a new one is — an edit that skipped the balance or
 * consecutive-day check would be a way to smuggle in a request that apply would
 * have refused.
 *
 * `excludeRequestId` is the row being amended: it must not count as an overlap
 * with itself.
 */
async function validateRequestInput(
  tx: DrizzleTx,
  ctx: LeaveCtx,
  data: ApplyLeaveRequestInput,
  excludeRequestId: string | null,
): Promise<{ leaveTypeId: string; approvalLevels: number; daysCount: number }> {
  const leaveType = await resolveLeaveType(tx, ctx.tenant_id, data.leave_type_name);

  // Effective policy as of the request start date.
  const policy = await resolveEffectivePolicy(tx, ctx.tenant_id, ctx.org_id, leaveType.id, data.start_date);
  if (!policy) throw new BadRequestError(`No active leave policy for ${data.leave_type_name}`);

  // Half-day allowed?
  const usesHalf = data.start_half !== 'full' || data.end_half !== 'full';
  if (usesHalf && !policy.allow_half_day) {
    throw new BadRequestError('This leave type does not allow half-days');
  }

  // Minimum notice.
  if (policy.min_notice_days > 0) {
    const noticeDays = Math.floor(
      (Date.parse(data.start_date) - Date.parse(todayIso())) / 86_400_000,
    );
    if (noticeDays < policy.min_notice_days) {
      throw new BadRequestError(`This leave requires at least ${policy.min_notice_days} day(s) notice`);
    }
  }

  // Server-computed days_count (client value, if any, is ignored).
  const holidays = await orgHolidaysBetween(tx, ctx.org_id, data.start_date, data.end_date);
  const offs = await weeklyOffPattern(tx, ctx.org_id, ctx.user_id);
  const daysCount = computeLeaveDays(
    data.start_date,
    data.end_date,
    data.start_half as HalfDay,
    data.end_half as HalfDay,
    holidays,
    offs,
  );
  if (daysCount <= 0) {
    throw new BadRequestError('The requested dates contain no working days');
  }

  // Max consecutive days.
  if (policy.max_consecutive_days != null && daysCount > policy.max_consecutive_days) {
    throw new BadRequestError(`This leave type allows at most ${policy.max_consecutive_days} consecutive day(s)`);
  }

  // Document requirement.
  if (
    policy.requires_document_after_days != null &&
    daysCount > policy.requires_document_after_days &&
    !data.document_url
  ) {
    throw new BadRequestError(
      `A supporting document is required for ${data.leave_type_name} longer than ${policy.requires_document_after_days} day(s)`,
    );
  }

  // Sufficient balance (loss_of_pay is exempt — it goes negative by design).
  // A pending request consumes nothing from the ledger (consumption happens on
  // approval), so on an edit this compares against the same balance apply saw.
  if (leaveType.name !== 'loss_of_pay') {
    const balance = await currentBalance(tx, ctx.org_id, ctx.user_id, leaveType.id);
    if (balance < daysCount) {
      throw new BadRequestError(`Insufficient ${data.leave_type_name} balance: have ${balance}, need ${daysCount}`);
    }
  }

  // Overlap guard (clean error before hitting the exclusion constraint).
  const selfClause = excludeRequestId ? sql`AND id <> ${excludeRequestId}` : sql``;
  const overlap = (await tx.execute(sql`
    SELECT 1 FROM hr.leave_requests
    WHERE user_id = ${ctx.user_id} AND is_open AND NOT is_deleted ${selfClause}
      AND daterange(start_date, end_date, '[]') && daterange(${data.start_date}::date, ${data.end_date}::date, '[]')
    LIMIT 1
  `)) as unknown as Row[];
  if (overlap.length > 0) {
    throw new ConflictError('You already have an overlapping leave request');
  }

  return { leaveTypeId: leaveType.id, approvalLevels: policy.approval_levels, daysCount };
}

export async function applyLeave(ctx: LeaveCtx, data: ApplyLeaveRequestInput): Promise<ApplyResult> {
  return serviceTxWithContext(ctx, data.reason ?? null, async (tx) => {
    const { leaveTypeId, approvalLevels, daysCount } = await validateRequestInput(tx, ctx, data, null);

    const pendingStatusId = await resolveStatusId(tx, ctx.tenant_id, 'pending');

    const inserted = (await tx.execute(sql`
      INSERT INTO hr.leave_requests
        (user_id, org_id, leave_type_id, start_date, end_date, start_half, end_half,
         days_count, reason, status_id, document_url, created_by)
      VALUES
        (${ctx.user_id}, ${ctx.org_id}, ${leaveTypeId}, ${data.start_date}, ${data.end_date},
         ${data.start_half}, ${data.end_half}, ${daysCount}, ${data.reason ?? null},
         ${pendingStatusId}, ${data.document_url ?? null}, ${ctx.user_id})
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    const requestId = inserted[0]!.id;

    // Approval chain from the effective policy's depth.
    const approvers = await resolveApprovers(tx, ctx.org_id, ctx.user_id, approvalLevels);
    for (const a of approvers) {
      await tx.execute(sql`
        INSERT INTO hr.leave_request_approvals (leave_request_id, org_id, level, approver_id)
        VALUES (${requestId}, ${ctx.org_id}, ${a.level}, ${a.approverId})
      `);
    }

    return {
      id: requestId,
      days_count: daysCount,
      level1_approver_id: approvers[0]?.approverId ?? null,
    };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// PREVIEW (read-only) — powers the apply form's live working-days display.
// Reuses computeLeaveDays, resolveEffectivePolicy and the same reads/validations
// as applyLeave, but commits nothing and returns warnings instead of throwing.
// Own-scope read → withRoleTx so hr.* RLS applies (leave_policies is tenant-
// scoped for app_user, so tenant-wide rows resolve correctly).
// ═════════════════════════════════════════════════════════════════════════════
export interface PreviewResult {
  days_count: number;
  balance: number;
  is_paid: boolean;
  allow_half_day: boolean;
  requires_document_after_days: number | null;
  max_consecutive_days: number | null;
  min_notice_days: number;
  sufficient: boolean;
  warnings: string[];
}

export async function previewLeave(ctx: LeaveCtx, data: PreviewLeaveRequestInput): Promise<PreviewResult> {
  return withRoleTx(ctx, async (tx) => {
    const leaveType = await resolveLeaveType(tx, ctx.tenant_id, data.leave_type_name);
    const policy = await resolveEffectivePolicy(tx, ctx.tenant_id, ctx.org_id, leaveType.id, data.start_date);

    const balance = await currentBalance(tx, ctx.org_id, ctx.user_id, leaveType.id);

    if (!policy) {
      return {
        days_count: 0,
        balance,
        is_paid: leaveType.is_paid,
        allow_half_day: false,
        requires_document_after_days: null,
        max_consecutive_days: null,
        min_notice_days: 0,
        sufficient: false,
        warnings: [`No active leave policy for ${data.leave_type_name}`],
      };
    }

    const warnings: string[] = [];

    const usesHalf = data.start_half !== 'full' || data.end_half !== 'full';
    if (usesHalf && !policy.allow_half_day) {
      warnings.push('This leave type does not allow half-days');
    }

    if (policy.min_notice_days > 0) {
      const noticeDays = Math.floor((Date.parse(data.start_date) - Date.parse(todayIso())) / 86_400_000);
      if (noticeDays < policy.min_notice_days) {
        warnings.push(`This leave requires at least ${policy.min_notice_days} day(s) notice`);
      }
    }

    const holidays = await orgHolidaysBetween(tx, ctx.org_id, data.start_date, data.end_date);
    const offs = await weeklyOffPattern(tx, ctx.org_id, ctx.user_id);
    const daysCount = computeLeaveDays(
      data.start_date,
      data.end_date,
      data.start_half as HalfDay,
      data.end_half as HalfDay,
      holidays,
      offs,
    );
    if (daysCount <= 0) {
      warnings.push('The requested dates contain no working days');
    }

    if (policy.max_consecutive_days != null && daysCount > policy.max_consecutive_days) {
      warnings.push(`This leave type allows at most ${policy.max_consecutive_days} consecutive day(s)`);
    }

    if (policy.requires_document_after_days != null && daysCount > policy.requires_document_after_days) {
      warnings.push(
        `A supporting document is required for ${data.leave_type_name} longer than ${policy.requires_document_after_days} day(s)`,
      );
    }

    const isLop = leaveType.name === 'loss_of_pay';
    const sufficient = isLop || balance >= daysCount;
    if (!sufficient) {
      warnings.push(`Insufficient ${data.leave_type_name} balance: have ${balance}, need ${daysCount}`);
    }

    return {
      days_count: daysCount,
      balance,
      is_paid: leaveType.is_paid,
      allow_half_day: policy.allow_half_day,
      requires_document_after_days: policy.requires_document_after_days,
      max_consecutive_days: policy.max_consecutive_days,
      min_notice_days: policy.min_notice_days,
      sufficient,
      warnings,
    };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// APPROVE / REJECT
// ═════════════════════════════════════════════════════════════════════════════
interface RequestForAction {
  id: string;
  user_id: string;
  org_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days_count: number;
  status_name: string;
}

async function loadRequestForAction(tx: DrizzleTx, id: string): Promise<RequestForAction | null> {
  const rows = (await tx.execute(sql`
    SELECT lr.id::text, lr.user_id::text, lr.org_id::text, lr.leave_type_id::text,
           lr.start_date::text, lr.end_date::text, lr.days_count::float8 AS days_count,
           s.name AS status_name
    FROM hr.leave_requests lr
    JOIN hr.leave_request_statuses s ON s.id = lr.status_id
    WHERE lr.id = ${id} AND NOT lr.is_deleted
  `)) as unknown as RequestForAction[];
  return rows[0] ?? null;
}

interface PendingLevel {
  id: string;
  level: number;
  approver_id: string;
}

async function currentPendingLevel(tx: DrizzleTx, requestId: string): Promise<PendingLevel | null> {
  const rows = (await tx.execute(sql`
    SELECT id::text, level, approver_id::text
    FROM hr.leave_request_approvals
    WHERE leave_request_id = ${requestId} AND action = 'pending'
    ORDER BY level ASC
    LIMIT 1
  `)) as unknown as PendingLevel[];
  return rows[0] ?? null;
}

async function hasFurtherPending(tx: DrizzleTx, requestId: string, level: number): Promise<PendingLevel | null> {
  const rows = (await tx.execute(sql`
    SELECT id::text, level, approver_id::text
    FROM hr.leave_request_approvals
    WHERE leave_request_id = ${requestId} AND action = 'pending' AND level > ${level}
    ORDER BY level ASC
    LIMIT 1
  `)) as unknown as PendingLevel[];
  return rows[0] ?? null;
}

async function canApproveLeave(tx: DrizzleTx, orgId: string, approverId: string, requesterId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT hr.can_approve_leave(${orgId}, ${approverId}, ${requesterId}) AS ok
  `)) as unknown as Array<{ ok: boolean }>;
  return rows[0]?.ok ?? false;
}

export interface DecisionResult {
  request_id: string;
  requester_id: string;
  org_id: string;
  final: boolean;
  next_approver_id: string | null;
}

export async function approveLeave(
  ctx: LeaveCtx,
  id: string,
  comment: string | null,
  isOverride: boolean,
): Promise<DecisionResult> {
  return serviceTxWithContext(ctx, comment, async (tx) => {
    const req = await loadRequestForAction(tx, id);
    if (!req) throw new NotFoundError('Leave request not found');
    if (req.org_id !== ctx.org_id) throw new NotFoundError('Leave request not found');
    if (req.status_name !== 'pending') throw new ConflictError(`Request is already ${req.status_name}`);

    const pending = await currentPendingLevel(tx, id);
    if (!pending) throw new ConflictError('No pending approval level for this request');

    // Authorization: the resolved approver for the current level, or an
    // authorized override (rank>=80 / hr_admin). Everyone must also pass the
    // structural can_approve_leave check (never approve your own request).
    const isAssignedApprover = pending.approver_id === ctx.user_id;
    if (!isAssignedApprover && !isOverride) {
      throw new ForbiddenError('You are not the approver for this level');
    }
    if (!(await canApproveLeave(tx, ctx.org_id, ctx.user_id, req.user_id))) {
      throw new ForbiddenError('You are not authorized to approve this request');
    }

    // Record who acted — annotate the override so the acting user is captured
    // even when they are not the row's designated approver.
    const actComment = isAssignedApprover
      ? comment
      : `[override by ${ctx.user_id}] ${comment ?? ''}`.trim();

    await tx.execute(sql`
      UPDATE hr.leave_request_approvals
      SET action = 'approved', acted_at = CLOCK_TIMESTAMP(), comment = ${actComment}
      WHERE id = ${pending.id}
    `);

    const next = await hasFurtherPending(tx, id, pending.level);
    if (next) {
      return { request_id: id, requester_id: req.user_id, org_id: req.org_id, final: false, next_approver_id: next.approver_id };
    }

    // Final level → approve the request and consume the balance in the same tx.
    const approvedStatusId = await resolveStatusId(tx, ctx.tenant_id, 'approved');
    await tx.execute(sql`
      UPDATE hr.leave_requests SET status_id = ${approvedStatusId} WHERE id = ${id}
    `);
    await tx.execute(sql`
      INSERT INTO hr.leave_ledger
        (user_id, org_id, leave_type_id, entry_type, amount, leave_request_id, effective_date, note, created_by)
      VALUES
        (${req.user_id}, ${req.org_id}, ${req.leave_type_id}, 'consumption', ${-req.days_count},
         ${id}, ${req.start_date}, 'Leave consumption', ${ctx.user_id})
    `);

    // Attendance integration: mark each date in the leave span 'on_leave' so the
    // attendance day is pre-resolved. Never overwrites a 'regularization' row; the
    // nightly resolution job treats these as already resolved. attendance_days is
    // service-write-only, so this runs here inside the same service transaction.
    await tx.execute(sql`
      INSERT INTO hr.attendance_days
        (user_id, org_id, work_date, status_id, leave_request_id, resolved_at, resolution_source)
      SELECT ${req.user_id}, ${req.org_id}, gs::date,
             (SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${ctx.tenant_id} AND name = 'on_leave'),
             ${id}, CLOCK_TIMESTAMP(), 'leave'
      FROM generate_series(${req.start_date}::date, ${req.end_date}::date, INTERVAL '1 day') gs
      ON CONFLICT (user_id, work_date) DO UPDATE SET
        status_id = EXCLUDED.status_id, leave_request_id = EXCLUDED.leave_request_id,
        resolved_at = CLOCK_TIMESTAMP(), resolution_source = 'leave', updated_at = CLOCK_TIMESTAMP()
      WHERE hr.attendance_days.resolution_source IS DISTINCT FROM 'regularization'
    `);

    return { request_id: id, requester_id: req.user_id, org_id: req.org_id, final: true, next_approver_id: null };
  });
}

export async function rejectLeave(
  ctx: LeaveCtx,
  id: string,
  comment: string,
  isOverride: boolean,
): Promise<DecisionResult> {
  return serviceTxWithContext(ctx, comment, async (tx) => {
    const req = await loadRequestForAction(tx, id);
    if (!req) throw new NotFoundError('Leave request not found');
    if (req.org_id !== ctx.org_id) throw new NotFoundError('Leave request not found');
    if (req.status_name !== 'pending') throw new ConflictError(`Request is already ${req.status_name}`);

    const pending = await currentPendingLevel(tx, id);
    if (!pending) throw new ConflictError('No pending approval level for this request');

    const isAssignedApprover = pending.approver_id === ctx.user_id;
    if (!isAssignedApprover && !isOverride) {
      throw new ForbiddenError('You are not the approver for this level');
    }
    if (!(await canApproveLeave(tx, ctx.org_id, ctx.user_id, req.user_id))) {
      throw new ForbiddenError('You are not authorized to act on this request');
    }

    const actComment = isAssignedApprover ? comment : `[override by ${ctx.user_id}] ${comment}`;

    await tx.execute(sql`
      UPDATE hr.leave_request_approvals
      SET action = 'rejected', acted_at = CLOCK_TIMESTAMP(), comment = ${actComment}
      WHERE id = ${pending.id}
    `);

    const rejectedStatusId = await resolveStatusId(tx, ctx.tenant_id, 'rejected');
    await tx.execute(sql`UPDATE hr.leave_requests SET status_id = ${rejectedStatusId} WHERE id = ${id}`);

    // No ledger row on rejection.
    return { request_id: id, requester_id: req.user_id, org_id: req.org_id, final: true, next_approver_id: null };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// CANCEL (owner)
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Amend a request that is still pending.
 *
 * Only the requester, and only while pending: once a decision exists the
 * request is a record of what was decided, and the remedy is cancel-and-reapply
 * (or, for dates already past, a regularization).
 *
 * The approval chain is REBUILT, not preserved. An edit can change the leave
 * type — and with it the policy's approval depth — and any decision already
 * recorded at level 1 of a multi-level chain was a decision about the OLD dates.
 * Carrying those rows forward would let an approved level stand for a request
 * nobody approved, so every level is dropped and re-resolved, putting the
 * request back at the start of its chain.
 */
export async function updateLeaveRequest(
  ctx: LeaveCtx,
  id: string,
  data: UpdateLeaveRequestInput,
): Promise<{ days_count: number; level1_approver_id: string | null }> {
  return serviceTxWithContext(ctx, data.reason ?? null, async (tx) => {
    const req = await loadRequestForAction(tx, id);
    if (!req) throw new NotFoundError('Leave request not found');
    if (req.user_id !== ctx.user_id) throw new ForbiddenError('You can only edit your own leave requests');
    if (req.status_name !== 'pending') {
      throw new ConflictError(`Cannot edit a request that is ${req.status_name}`);
    }

    const { leaveTypeId, approvalLevels, daysCount } = await validateRequestInput(tx, ctx, data, id);

    await tx.execute(sql`
      UPDATE hr.leave_requests
      SET leave_type_id = ${leaveTypeId}, start_date = ${data.start_date}, end_date = ${data.end_date},
          start_half = ${data.start_half}, end_half = ${data.end_half}, days_count = ${daysCount},
          reason = ${data.reason ?? null}, document_url = ${data.document_url ?? null}
      WHERE id = ${id}
    `);

    await tx.execute(sql`DELETE FROM hr.leave_request_approvals WHERE leave_request_id = ${id}`);
    const approvers = await resolveApprovers(tx, ctx.org_id, ctx.user_id, approvalLevels);
    for (const a of approvers) {
      await tx.execute(sql`
        INSERT INTO hr.leave_request_approvals (leave_request_id, org_id, level, approver_id)
        VALUES (${id}, ${ctx.org_id}, ${a.level}, ${a.approverId})
      `);
    }

    return { days_count: daysCount, level1_approver_id: approvers[0]?.approverId ?? null };
  });
}

export async function cancelLeave(ctx: LeaveCtx, id: string, comment: string | null): Promise<void> {
  return serviceTxWithContext(ctx, comment, async (tx) => {
    const req = await loadRequestForAction(tx, id);
    if (!req) throw new NotFoundError('Leave request not found');
    if (req.user_id !== ctx.user_id) throw new ForbiddenError('You can only cancel your own leave requests');

    // Pending only. An approved request has already moved the balance ledger and
    // written its 'on_leave' attendance days, and an approver — not the requester
    // — owns that decision; reversing it is an hr_admin adjustment, not a
    // self-service cancel. This is the authoritative check: the UI hides the
    // button for the same reason, but a direct API call must fail here too.
    if (req.status_name !== 'pending') {
      throw new ConflictError(
        `Cannot cancel a request that is ${req.status_name} — ask HR to reverse it`,
      );
    }

    const cancelledStatusId = await resolveStatusId(tx, ctx.tenant_id, 'cancelled');
    await tx.execute(sql`UPDATE hr.leave_requests SET status_id = ${cancelledStatusId} WHERE id = ${id}`);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// MANUAL ADJUSTMENT (hr_admin / org_admin)
// ═════════════════════════════════════════════════════════════════════════════
export async function createAdjustment(ctx: LeaveCtx, data: CreateAdjustmentInput): Promise<{ id: string }> {
  return serviceTxWithContext(ctx, data.note, async (tx) => {
    const leaveType = await resolveLeaveType(tx, ctx.tenant_id, data.leave_type_name);
    // Target user must be a member of the acting org.
    const member = (await tx.execute(sql`
      SELECT 1 FROM iam.user_org_mapping WHERE user_id = ${data.user_id} AND org_id = ${ctx.org_id} AND is_active LIMIT 1
    `)) as unknown as Row[];
    if (member.length === 0) throw new BadRequestError('Target user is not an active member of this org');

    const rows = (await tx.execute(sql`
      INSERT INTO hr.leave_ledger
        (user_id, org_id, leave_type_id, entry_type, amount, effective_date, note, created_by)
      VALUES
        (${data.user_id}, ${ctx.org_id}, ${leaveType.id}, 'adjustment', ${data.amount},
         ${data.effective_date ?? todayIso()}, ${data.note}, ${ctx.user_id})
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    return { id: rows[0]!.id };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// READS — own scope (withRoleTx, RLS applies)
// ═════════════════════════════════════════════════════════════════════════════
export async function listOwnRequests(ctx: LeaveCtx, filters: ListLeaveRequestsInput) {
  return withRoleTx(ctx, async (tx) => {
    const { page, limit, status, from, to } = filters;
    const offset = (page - 1) * limit;
    const statusClause = status ? sql`AND e.status_name = ${status}` : sql``;
    const fromClause = from ? sql`AND e.end_date >= ${from}` : sql``;
    const toClause = to ? sql`AND e.start_date <= ${to}` : sql``;

    const rows = (await tx.execute(sql`
      SELECT * FROM hr.vw_leave_requests_enriched e
      WHERE e.user_id = ${ctx.user_id}
      ${statusClause} ${fromClause} ${toClause}
      ORDER BY e.start_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];

    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM hr.vw_leave_requests_enriched e
      WHERE e.user_id = ${ctx.user_id}
      ${statusClause} ${fromClause} ${toClause}
    `)) as unknown as Array<{ count: number }>;

    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

/**
 * Balance per leave type as on a date — the whole employee-facing leave payload.
 *
 * Deliberately minimal: type, label, paid flag, the number, whether half-days
 * are allowed, and whether a policy is in force. NOTHING about how the number is
 * produced. Accrual frequency and amount, max balance, carry-forward caps,
 * notice rules and approval depth stay behind hr.leave.admin.policies.view; the
 * per-request limits an applicant actually needs (notice, document threshold,
 * max consecutive days) arrive just-in-time from /leave/requests/preview.
 *
 * `asOf` always dates the POLICY (same rule as resolveEffectivePolicy, widened
 * from one type to all of them). It bounds the ledger sum only when the caller
 * asked for a specific date: approveLeave writes its consumption row with
 * effective_date = start_date, i.e. usually in the future, while the
 * authoritative sufficiency check `currentBalance()` above sums the ledger
 * unbounded. Defaulting to `effective_date <= today` would therefore show more
 * days on the cards than the apply flow will actually let the employee book.
 */
// Exported for balances-payload.test.ts, which asserts the SELECT list leaks no
// policy internals — the actual guard on this module's privacy contract.
export function balancesQuery(userId: string, orgId: string, tenantId: string, asOf: string, boundLedger: boolean) {
  const ledgerBound = boundLedger ? sql`AND ll.effective_date <= ${asOf}` : sql``;
  return sql`
    WITH eff AS (
      SELECT DISTINCT ON (p.leave_type_id) p.leave_type_id, p.allow_half_day
      FROM hr.leave_policies p
      WHERE p.tenant_id = ${tenantId}
        AND p.is_active AND NOT p.is_deleted
        AND p.applicable_from <= ${asOf}
        AND (p.org_id = ${orgId} OR p.org_id IS NULL)
      ORDER BY p.leave_type_id, (p.org_id IS NOT NULL) DESC, p.applicable_from DESC
    ),
    led AS (
      SELECT ll.leave_type_id, SUM(ll.amount)::float8 AS balance
      FROM hr.leave_ledger ll
      WHERE ll.user_id = ${userId} AND ll.org_id = ${orgId}
      ${ledgerBound}
      GROUP BY ll.leave_type_id
    )
    SELECT lt.id::text                         AS leave_type_id,
           lt.name                             AS leave_type_name,
           lt.label                            AS leave_type_label,
           lt.is_paid,
           COALESCE(led.balance, 0)::float8    AS balance,
           COALESCE(eff.allow_half_day, FALSE) AS allow_half_day,
           (eff.leave_type_id IS NOT NULL)     AS has_policy
    FROM hr.leave_types lt
    LEFT JOIN eff ON eff.leave_type_id = lt.id
    LEFT JOIN led ON led.leave_type_id = lt.id
    WHERE lt.tenant_id = ${tenantId}
      AND lt.is_active
      -- A type is shown when it is bookable now (a policy is in force) or still
      -- carries a residual balance from one that was withdrawn.
      AND (eff.leave_type_id IS NOT NULL OR led.leave_type_id IS NOT NULL)
    ORDER BY lt.sort_order NULLS LAST, lt.name
  `;
}

export async function listOwnBalances(ctx: LeaveCtx, filters: ListBalancesInput) {
  const asOf = filters.as_of ?? todayIso();
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(
      balancesQuery(ctx.user_id, ctx.org_id, ctx.tenant_id, asOf, filters.as_of != null),
    )) as unknown as Row[];
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// READS — other-user / team scope (service tx after app-layer authorization)
// ═════════════════════════════════════════════════════════════════════════════

/** True when acting user may view target's leave: self, subtree manager, hr_admin, org_admin. */
export async function canViewUserLeave(ctx: LeaveCtx, targetUserId: string): Promise<boolean> {
  if (targetUserId === ctx.user_id) return true;
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1
      FROM iam.vw_user_team_members
      WHERE manager_id = ${ctx.user_id} AND member_id = ${targetUserId} AND org_id = ${ctx.org_id}
      LIMIT 1
    `)) as unknown as Row[];
    return rows.length > 0;
  });
}

// Same payload for another employee (manager / HR view). Stays on the service tx:
// under app_user the target's hr.leave_ledger rows are invisible by RLS. The
// caller is authorized in the service layer by assertCanViewUser.
export async function getUserBalances(ctx: LeaveCtx, targetUserId: string, filters: ListBalancesInput) {
  const asOf = filters.as_of ?? todayIso();
  return withServiceTx(async (tx) => {
    return (await tx.execute(
      balancesQuery(targetUserId, ctx.org_id, ctx.tenant_id, asOf, filters.as_of != null),
    )) as unknown as Row[];
  });
}

export async function listLedger(ctx: LeaveCtx, targetUserId: string, page: number, limit: number) {
  return withServiceTx(async (tx) => {
    const offset = (page - 1) * limit;
    const rows = (await tx.execute(sql`
      SELECT ll.id::text, ll.leave_type_id::text, lt.name AS leave_type_name, lt.label AS leave_type_label,
             ll.entry_type, ll.amount::float8 AS amount, ll.leave_request_id::text,
             ll.period, ll.effective_date::text, ll.note, ll.created_at
      FROM hr.leave_ledger ll
      JOIN hr.leave_types lt ON lt.id = ll.leave_type_id
      WHERE ll.user_id = ${targetUserId} AND ll.org_id = ${ctx.org_id}
      ORDER BY ll.effective_date DESC, ll.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM hr.leave_ledger
      WHERE user_id = ${targetUserId} AND org_id = ${ctx.org_id}
    `)) as unknown as Array<{ count: number }>;
    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

export async function listTeamRequests(ctx: LeaveCtx, filters: ListLeaveRequestsInput, seeAllOrg: boolean) {
  return withServiceTx(async (tx) => {
    const { page, limit, status, from, to } = filters;
    const offset = (page - 1) * limit;
    const statusClause = status ? sql`AND e.status_name = ${status}` : sql``;
    const fromClause = from ? sql`AND e.end_date >= ${from}` : sql``;
    const toClause = to ? sql`AND e.start_date <= ${to}` : sql``;
    // Org admins / hr_admin see the whole org; managers see their subtree or
    // requests where they are a pending approver.
    const scopeClause = seeAllOrg
      ? sql``
      : sql`AND (
          EXISTS (SELECT 1 FROM hr.leave_request_approvals a
                  WHERE a.leave_request_id = e.id AND a.approver_id = ${ctx.user_id} AND a.action = 'pending')
          OR EXISTS (SELECT 1 FROM iam.vw_user_team_members m
                     WHERE m.manager_id = ${ctx.user_id} AND m.member_id = e.user_id AND m.org_id = ${ctx.org_id})
        )`;

    const rows = (await tx.execute(sql`
      SELECT * FROM hr.vw_leave_requests_enriched e
      WHERE e.org_id = ${ctx.org_id} ${scopeClause}
      ${statusClause} ${fromClause} ${toClause}
      ORDER BY e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];

    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM hr.vw_leave_requests_enriched e
      WHERE e.org_id = ${ctx.org_id} ${scopeClause}
      ${statusClause} ${fromClause} ${toClause}
    `)) as unknown as Array<{ count: number }>;

    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// POLICIES
// ═════════════════════════════════════════════════════════════════════════════
export async function listPolicies(ctx: LeaveCtx, filters: ListPoliciesInput) {
  return withRoleTx(ctx, async (tx) => {
    const typeClause = filters.leave_type_name ? sql`AND lt.name = ${filters.leave_type_name}` : sql``;
    return (await tx.execute(sql`
      SELECT p.id::text, p.tenant_id::text, p.org_id::text, p.leave_type_id::text,
             lt.name AS leave_type_name, lt.label AS leave_type_label,
             p.accrual_frequency, p.accrual_amount::float8 AS accrual_amount,
             p.max_balance::float8 AS max_balance, p.carry_forward,
             p.max_carry_forward::float8 AS max_carry_forward, p.max_consecutive_days,
             p.min_notice_days, p.allow_half_day, p.requires_document_after_days,
             p.approval_levels, p.applicable_from::text, p.is_active
      FROM hr.leave_policies p
      JOIN hr.leave_types lt ON lt.id = p.leave_type_id
      WHERE p.tenant_id = ${ctx.tenant_id} AND NOT p.is_deleted
        AND (p.org_id = ${ctx.org_id} OR p.org_id IS NULL)
      ${typeClause}
      ORDER BY lt.name, (p.org_id IS NOT NULL) DESC, p.applicable_from DESC
    `)) as unknown as Row[];
  });
}

export async function createPolicy(ctx: LeaveCtx, data: CreatePolicyInput): Promise<{ id: string }> {
  return serviceTxWithContext(ctx, null, async (tx) => {
    const leaveType = await resolveLeaveType(tx, ctx.tenant_id, data.leave_type_name);
    const orgId = data.org_id ?? null;
    if (orgId) {
      const belongs = (await tx.execute(sql`
        SELECT 1 FROM entity.organizations WHERE id = ${orgId} AND tenant_id = ${ctx.tenant_id} LIMIT 1
      `)) as unknown as Row[];
      if (belongs.length === 0) throw new BadRequestError('org_id does not belong to your tenant');
    }
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.leave_policies
          (tenant_id, org_id, leave_type_id, accrual_frequency, accrual_amount, max_balance,
           carry_forward, max_carry_forward, max_consecutive_days, min_notice_days, allow_half_day,
           requires_document_after_days, approval_levels, applicable_from, created_by)
        VALUES
          (${ctx.tenant_id}, ${orgId}, ${leaveType.id}, ${data.accrual_frequency}, ${data.accrual_amount},
           ${data.max_balance ?? null}, ${data.carry_forward}, ${data.max_carry_forward ?? null},
           ${data.max_consecutive_days ?? null}, ${data.min_notice_days}, ${data.allow_half_day},
           ${data.requires_document_after_days ?? null}, ${data.approval_levels}, ${data.applicable_from}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        throw new ConflictError('A policy revision already exists for this scope, type and effective date');
      }
      throw err;
    }
  });
}

export async function updatePolicy(
  ctx: LeaveCtx,
  id: string,
  data: UpdatePolicyInput,
  canWriteTenantWide: boolean,
): Promise<void> {
  await serviceTxWithContext(ctx, null, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT applicable_from::text, tenant_id::text, org_id::text FROM hr.leave_policies
      WHERE id = ${id} AND NOT is_deleted
    `)) as unknown as Array<{ applicable_from: string; tenant_id: string; org_id: string | null }>;
    const row = rows[0];
    if (!row) throw new NotFoundError('Leave policy not found');
    if (row.tenant_id !== ctx.tenant_id) throw new NotFoundError('Leave policy not found');
    if (row.org_id === null && !canWriteTenantWide) {
      throw new ForbiddenError('Only a tenant admin can edit a tenant-wide policy');
    }
    if (Date.parse(row.applicable_from) <= Date.parse(todayIso())) {
      throw new BadRequestError(
        'Only future-dated policy revisions can be edited. Policy history is immutable — create a new revision with a later applicable_from instead.',
      );
    }

    const sets: ReturnType<typeof sql>[] = [];
    if (data.accrual_frequency !== undefined) sets.push(sql`accrual_frequency = ${data.accrual_frequency}`);
    if (data.accrual_amount !== undefined) sets.push(sql`accrual_amount = ${data.accrual_amount}`);
    if (data.max_balance !== undefined) sets.push(sql`max_balance = ${data.max_balance}`);
    if (data.carry_forward !== undefined) sets.push(sql`carry_forward = ${data.carry_forward}`);
    if (data.max_carry_forward !== undefined) sets.push(sql`max_carry_forward = ${data.max_carry_forward}`);
    if (data.max_consecutive_days !== undefined) sets.push(sql`max_consecutive_days = ${data.max_consecutive_days}`);
    if (data.min_notice_days !== undefined) sets.push(sql`min_notice_days = ${data.min_notice_days}`);
    if (data.allow_half_day !== undefined) sets.push(sql`allow_half_day = ${data.allow_half_day}`);
    if (data.requires_document_after_days !== undefined) sets.push(sql`requires_document_after_days = ${data.requires_document_after_days}`);
    if (data.approval_levels !== undefined) sets.push(sql`approval_levels = ${data.approval_levels}`);
    if (data.is_active !== undefined) sets.push(sql`is_active = ${data.is_active}`);
    if (sets.length === 0) return;

    await tx.execute(sql`
      UPDATE hr.leave_policies SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
    `);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// HOLIDAYS & CALENDARS (withRoleTx — RLS enforces org scope)
// ═════════════════════════════════════════════════════════════════════════════
export async function listHolidays(ctx: LeaveCtx, filters: ListHolidaysInput) {
  return withRoleTx(ctx, async (tx) => {
    const yearClause = filters.year ? sql`AND EXTRACT(YEAR FROM h.holiday_date) = ${filters.year}` : sql``;
    const calClause = filters.calendar_id ? sql`AND h.calendar_id = ${filters.calendar_id}` : sql``;
    return (await tx.execute(sql`
      SELECT h.id::text, h.calendar_id::text, h.org_id::text, h.holiday_date::text,
             h.name, h.is_optional, h.is_active
      FROM hr.holidays h
      WHERE h.org_id = ${ctx.org_id} AND NOT h.is_deleted
      ${yearClause} ${calClause}
      ORDER BY h.holiday_date
    `)) as unknown as Row[];
  });
}

export async function createHoliday(ctx: LeaveCtx, data: CreateHolidayInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    const cal = (await tx.execute(sql`
      SELECT 1 FROM hr.holiday_calendars WHERE id = ${data.calendar_id} AND org_id = ${ctx.org_id} AND NOT is_deleted LIMIT 1
    `)) as unknown as Row[];
    if (cal.length === 0) throw new BadRequestError('Holiday calendar not found for this org');
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.holidays (calendar_id, org_id, holiday_date, name, is_optional, created_by)
        VALUES (${data.calendar_id}, ${ctx.org_id}, ${data.holiday_date}, ${data.name}, ${data.is_optional}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        throw new ConflictError('A holiday already exists on that date in this calendar');
      }
      throw err;
    }
  });
}

export async function updateHoliday(ctx: LeaveCtx, id: string, data: UpdateHolidayInput): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const sets: ReturnType<typeof sql>[] = [];
    if (data.holiday_date !== undefined) sets.push(sql`holiday_date = ${data.holiday_date}`);
    if (data.name !== undefined) sets.push(sql`name = ${data.name}`);
    if (data.is_optional !== undefined) sets.push(sql`is_optional = ${data.is_optional}`);
    if (data.is_active !== undefined) sets.push(sql`is_active = ${data.is_active}`);
    if (sets.length === 0) return;
    const res = (await tx.execute(sql`
      UPDATE hr.holidays SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
      RETURNING id::text
    `)) as unknown as Row[];
    if (res.length === 0) throw new NotFoundError('Holiday not found');
  });
}

export async function listHolidayCalendars(ctx: LeaveCtx) {
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT id::text, org_id::text, name, year, is_active
      FROM hr.holiday_calendars
      WHERE org_id = ${ctx.org_id} AND NOT is_deleted
      ORDER BY year DESC, name
    `)) as unknown as Row[];
  });
}

export async function createHolidayCalendar(ctx: LeaveCtx, data: CreateHolidayCalendarInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.holiday_calendars (org_id, name, year, created_by)
        VALUES (${ctx.org_id}, ${data.name}, ${data.year}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        throw new ConflictError('A calendar with that name and year already exists');
      }
      throw err;
    }
  });
}

export async function updateHolidayCalendar(ctx: LeaveCtx, id: string, data: UpdateHolidayCalendarInput): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const sets: ReturnType<typeof sql>[] = [];
    if (data.name !== undefined) sets.push(sql`name = ${data.name}`);
    if (data.year !== undefined) sets.push(sql`year = ${data.year}`);
    if (data.is_active !== undefined) sets.push(sql`is_active = ${data.is_active}`);
    if (sets.length === 0) return;
    const res = (await tx.execute(sql`
      UPDATE hr.holiday_calendars SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
      RETURNING id::text
    `)) as unknown as Row[];
    if (res.length === 0) throw new NotFoundError('Holiday calendar not found');
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═════════════════════════════════════════════════════════════════════════════
export async function getEffectiveSettings(ctx: LeaveCtx) {
  return withRoleTx(ctx, async (tx) => {
    const month = await resolveCycleStartMonth(tx, ctx.tenant_id, ctx.org_id);
    return { leave_cycle_start_month: month };
  });
}

export async function upsertSettings(ctx: LeaveCtx, month: number, scope: 'org' | 'tenant'): Promise<void> {
  await serviceTxWithContext(ctx, null, async (tx) => {
    const orgId = scope === 'org' ? ctx.org_id : null;
    await tx.execute(sql`
      INSERT INTO hr.hr_settings (tenant_id, org_id, leave_cycle_start_month)
      VALUES (${ctx.tenant_id}, ${orgId}, ${month})
      ON CONFLICT (tenant_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET leave_cycle_start_month = EXCLUDED.leave_cycle_start_month, updated_at = CLOCK_TIMESTAMP()
    `);
  });
}
