// ─────────────────────────────────────────────────────────────────────────────
// Leave service — authorization, orchestration, activity logging, notifications.
// No SQL here (all DB access is in leave.repository). No req/res (that is the
// controller). Business rules that require in-transaction reads live in the
// repository, matching the established employees module split.
// ─────────────────────────────────────────────────────────────────────────────

import { logActivity } from '@platform/audit-log';
import {
  canManageLeave,
  canOverrideLeaveApproval,
  isTenantLeaveAdmin,
} from '@hr/authz';
import { createLogger } from '@platform/logger';
import { config } from '../../../config/index.js';
import { AppError, ForbiddenError } from '../../../lib/errors.js';
import { publishLeaveEvent } from '../../../lib/events.js';
import * as repo from './leave.repository.js';
import type { LeaveCtx } from './leave.repository.js';
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
  BulkLeaveDecisionInput,
  CreateCompOffClaimInput,
  CreateEncashmentInput,
} from '@hr/validation';

// Fired from the service layer, which has no request-scoped logger.
const log = createLogger({ service: 'hr-service', nodeEnv: config.nodeEnv });

// ── Requests ──────────────────────────────────────────────────────────────────
export async function applyLeave(ctx: LeaveCtx, data: ApplyLeaveRequestInput) {
  const result = await repo.applyLeave(ctx, data);
  if (result.level1_approver_id) {
    void publishLeaveEvent({
      type: 'leave:approval_pending',
      request_id: result.id,
      recipient_id: result.level1_approver_id,
      org_id: ctx.org_id,
      tenant_id: ctx.tenant_id,
      actor_id: ctx.user_id,
    });
  }
  void logActivity({
    action_type: 'leave_requested',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { request_id: result.id, days_count: result.days_count },
  });
  return result;
}

export async function previewLeave(ctx: LeaveCtx, data: PreviewLeaveRequestInput) {
  return repo.previewLeave(ctx, data);
}

export async function listOwnRequests(ctx: LeaveCtx, filters: ListLeaveRequestsInput) {
  return repo.listOwnRequests(ctx, filters);
}

export async function getRequestApprovals(ctx: LeaveCtx, id: string) {
  return repo.getRequestApprovals(ctx, id, canManageLeave(ctx), canOverrideLeaveApproval(ctx));
}

export async function getOwnRequestDetail(ctx: LeaveCtx, id: string) {
  return repo.getOwnRequestDetail(ctx, id);
}

export async function listTeamRequests(ctx: LeaveCtx, filters: ListLeaveRequestsInput) {
  // No blanket rank gate here: the repository query already self-scopes to
  // rows where the acting user is the resolved (reporting-line) approver or a
  // direct manager, so a caller with no HR product rank at all still only ever
  // sees their own relevant items — never the wider org. HR admin/manager rank
  // (canManageLeave) only widens the view to the full org queue. Gating the
  // call itself on canViewTeamLeave (HR rank >= manager) previously blocked a
  // reporting-line-resolved approver from ever seeing (or reaching, via the
  // /leave/approvals UI) a request assigned to them when they hadn't also been
  // separately granted an hr.member_roles row — see approveLeave, which
  // already allows the assigned approver through regardless of rank.
  const seeAllOrg = canManageLeave(ctx);
  return repo.listTeamRequests(ctx, filters, seeAllOrg);
}

export async function approveLeave(ctx: LeaveCtx, id: string, comment: string | null) {
  const isOverride = canOverrideLeaveApproval(ctx);
  const result = await repo.approveLeave(ctx, id, comment, isOverride);
  if (result.final) {
    void publishLeaveEvent({
      type: 'leave:approved',
      request_id: result.request_id,
      recipient_id: result.requester_id,
      org_id: result.org_id,
      tenant_id: ctx.tenant_id,
      actor_id: ctx.user_id,
    });
  } else if (result.next_approver_id) {
    void publishLeaveEvent({
      type: 'leave:approval_pending',
      request_id: result.request_id,
      recipient_id: result.next_approver_id,
      org_id: result.org_id,
      tenant_id: ctx.tenant_id,
      actor_id: ctx.user_id,
    });
  }
  void logActivity({
    action_type: 'leave_approved',
    performed_by: ctx.user_id,
    subject_user_id: result.requester_id,
    org_id: ctx.org_id,
    new_value: { request_id: id, final: result.final },
  });
  return result;
}

export async function rejectLeave(ctx: LeaveCtx, id: string, comment: string) {
  const isOverride = canOverrideLeaveApproval(ctx);
  const result = await repo.rejectLeave(ctx, id, comment, isOverride);
  void publishLeaveEvent({
    type: 'leave:rejected',
    request_id: result.request_id,
    recipient_id: result.requester_id,
    org_id: result.org_id,
    tenant_id: ctx.tenant_id,
    actor_id: ctx.user_id,
  });
  void logActivity({
    action_type: 'leave_rejected',
    performed_by: ctx.user_id,
    subject_user_id: result.requester_id,
    org_id: ctx.org_id,
    new_value: { request_id: id },
  });
  return result;
}

export interface BulkLeaveResult {
  request_id: string;
  ok: boolean;
  /** Why this request was skipped. Only ever an AppError message — never internals. */
  error?: string;
}

/**
 * Approve or reject many pending requests — skipping the ones that fail.
 *
 * Each request goes through the SAME function as its single route
 * (approveLeave / rejectLeave), each in its own transaction, so scope, the
 * approval chain, balance checks, audit and notifications behave exactly as a
 * single decision; bulk can do nothing a single click could not. Not atomic by
 * design (same product rule as LMS bulk actions): a failing request is reported
 * and the rest still apply. A request the actor may not decide resolves to an
 * error inside the single path, so a foreign id leaks nothing but its absence.
 * Sequential, so audit rows and events keep a deterministic order.
 */
export async function bulkDecideLeave(ctx: LeaveCtx, input: BulkLeaveDecisionInput) {
  const ids = [...new Set(input.request_ids)];
  const results: BulkLeaveResult[] = [];
  for (const id of ids) {
    try {
      if (input.decision === 'approve') await approveLeave(ctx, id, input.comment?.trim() || null);
      else await rejectLeave(ctx, id, input.comment!.trim());
      results.push({ request_id: id, ok: true });
    } catch (err) {
      if (err instanceof AppError) {
        results.push({ request_id: id, ok: false, error: err.message });
      } else {
        log.error({ err, request_id: id, decision: input.decision }, 'bulk leave decision failed unexpectedly');
        results.push({ request_id: id, ok: false, error: 'This request could not be decided' });
      }
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { decision: input.decision, requested: ids.length, succeeded, failed: ids.length - succeeded, results };
}

// ── Request more info, policy summary, encashment (1.64.0) ──────────────────
export async function requestLeaveInfo(ctx: LeaveCtx, id: string, comment: string) {
  const r = await repo.requestLeaveInfo(ctx, id, comment, canOverrideLeaveApproval(ctx));
  void publishLeaveEvent({
    type: 'leave:info_requested',
    request_id: r.request_id,
    recipient_id: r.requester_id,
    org_id: r.org_id,
    tenant_id: ctx.tenant_id,
    actor_id: ctx.user_id,
  });
  void logActivity({ action_type: 'leave_info_requested', performed_by: ctx.user_id, subject_user_id: r.requester_id, org_id: ctx.org_id, new_value: { request_id: id } });
  return r;
}

export const getPolicySummary = (ctx: LeaveCtx) => repo.getPolicySummary(ctx);

export async function createEncashment(ctx: LeaveCtx, data: CreateEncashmentInput) {
  const r = await repo.createEncashment(ctx, data);
  void logActivity({ action_type: 'leave_encashment_requested', performed_by: ctx.user_id, subject_user_id: ctx.user_id, org_id: ctx.org_id, new_value: { request_id: r.id, days: data.days } });
  return r;
}
export const listOwnEncashments = (ctx: LeaveCtx) => repo.listOwnEncashments(ctx);
export const listEncashmentQueue = (ctx: LeaveCtx, status: repo.EncashmentView['status']) =>
  repo.listEncashmentQueue(ctx, status, canManageLeave(ctx));

export async function decideEncashment(ctx: LeaveCtx, id: string, decision: 'approve' | 'reject', comment: string | null) {
  const r = await repo.decideEncashment(ctx, id, decision, comment, canOverrideLeaveApproval(ctx));
  void logActivity({
    action_type: decision === 'approve' ? 'leave_encashment_approved' : 'leave_encashment_rejected',
    performed_by: ctx.user_id, subject_user_id: r.requester_id, org_id: ctx.org_id, new_value: { request_id: id, days: r.days },
  });
  return r;
}

export async function cancelEncashment(ctx: LeaveCtx, id: string) {
  await repo.cancelEncashment(ctx, id);
  void logActivity({ action_type: 'leave_encashment_cancelled', performed_by: ctx.user_id, subject_user_id: ctx.user_id, org_id: ctx.org_id, new_value: { request_id: id } });
}

// ── Comp-off ────────────────────────────────────────────────────────────────
export async function createCompOffClaim(ctx: LeaveCtx, data: CreateCompOffClaimInput) {
  const result = await repo.createCompOffClaim(ctx, data);
  void logActivity({
    action_type: 'comp_off_claimed',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { claim_id: result.id, worked_date: data.worked_date, days: data.days },
  });
  return result;
}

export async function listOwnCompOffClaims(ctx: LeaveCtx) {
  return repo.listOwnCompOffClaims(ctx);
}

export async function listCompOffQueue(ctx: LeaveCtx, status: repo.CompOffClaimView['status']) {
  // Same scoping as the leave approvals queue: leave admins see the whole org,
  // everyone else only claims assigned to them or from their team.
  return repo.listCompOffForApproval(ctx, status, canManageLeave(ctx));
}

export async function decideCompOffClaim(
  ctx: LeaveCtx,
  id: string,
  decision: 'approve' | 'reject',
  comment: string | null,
) {
  const result = await repo.decideCompOffClaim(ctx, id, decision, comment, canOverrideLeaveApproval(ctx));
  void logActivity({
    action_type: decision === 'approve' ? 'comp_off_approved' : 'comp_off_rejected',
    performed_by: ctx.user_id,
    subject_user_id: result.requester_id,
    org_id: ctx.org_id,
    new_value: { claim_id: id, days: result.days },
  });
  return result;
}

export async function cancelCompOffClaim(ctx: LeaveCtx, id: string) {
  await repo.cancelCompOffClaim(ctx, id);
  void logActivity({
    action_type: 'comp_off_cancelled',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { claim_id: id },
  });
}

export async function updateLeaveRequest(ctx: LeaveCtx, id: string, data: UpdateLeaveRequestInput) {
  const result = await repo.updateLeaveRequest(ctx, id, data);
  // The chain was rebuilt, so whoever holds level 1 now has a request waiting —
  // including the same approver, whose earlier view of it is out of date.
  if (result.level1_approver_id) {
    void publishLeaveEvent({
      type: 'leave:approval_pending',
      request_id: id,
      recipient_id: result.level1_approver_id,
      org_id: ctx.org_id,
      tenant_id: ctx.tenant_id,
      actor_id: ctx.user_id,
    });
  }
  void logActivity({
    action_type: 'leave_updated',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { request_id: id, days_count: result.days_count },
  });
  return result;
}

export async function cancelLeave(ctx: LeaveCtx, id: string, comment: string | null) {
  await repo.cancelLeave(ctx, id, comment);
  void logActivity({
    action_type: 'leave_cancelled',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { request_id: id },
  });
}

// ── Balances & ledger ───────────────────────────────────────────────────────
export async function listOwnBalances(ctx: LeaveCtx, filters: ListBalancesInput) {
  return repo.listOwnBalances(ctx, filters);
}

async function assertCanViewUser(ctx: LeaveCtx, targetUserId: string) {
  if (targetUserId === ctx.user_id) return;
  if (canManageLeave(ctx)) return; // hr_admin / org_admin see any in-org
  if (await repo.canViewUserLeave(ctx, targetUserId)) return; // subtree manager
  throw new ForbiddenError('Not authorized to view this user’s leave');
}

export async function getUserBalances(ctx: LeaveCtx, targetUserId: string, filters: ListBalancesInput) {
  await assertCanViewUser(ctx, targetUserId);
  return repo.getUserBalances(ctx, targetUserId, filters);
}

export async function listLedger(ctx: LeaveCtx, targetUserId: string, page: number, limit: number) {
  await assertCanViewUser(ctx, targetUserId);
  return repo.listLedger(ctx, targetUserId, page, limit);
}

export async function createAdjustment(ctx: LeaveCtx, data: CreateAdjustmentInput) {
  if (!canManageLeave(ctx)) {
    throw new ForbiddenError('Only HR admins or org admins can make manual ledger adjustments');
  }
  const result = await repo.createAdjustment(ctx, data);
  void logActivity({
    action_type: 'leave_adjustment_created',
    performed_by: ctx.user_id,
    subject_user_id: data.user_id,
    org_id: ctx.org_id,
    new_value: { amount: data.amount, leave_type: data.leave_type_name, note: data.note },
  });
  return result;
}

// ── Policies ──────────────────────────────────────────────────────────────────
export async function listPolicies(ctx: LeaveCtx, filters: ListPoliciesInput) {
  return repo.listPolicies(ctx, filters);
}

export async function createPolicy(ctx: LeaveCtx, data: CreatePolicyInput) {
  const tenantWide = data.org_id == null;
  if (tenantWide) {
    if (!isTenantLeaveAdmin(ctx.role)) {
      throw new ForbiddenError('Only a tenant admin can create a tenant-wide leave policy');
    }
  } else if (!canManageLeave(ctx)) {
    throw new ForbiddenError('Only HR admins or org admins can create leave policies');
  }
  const result = await repo.createPolicy(ctx, data);
  void logActivity({
    action_type: 'leave_policy_created',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { policy_id: result.id, leave_type: data.leave_type_name, tenant_wide: tenantWide },
  });
  return result;
}

export async function updatePolicy(ctx: LeaveCtx, id: string, data: UpdatePolicyInput) {
  if (!canManageLeave(ctx)) {
    throw new ForbiddenError('Only HR admins or org admins can edit leave policies');
  }
  await repo.updatePolicy(ctx, id, data, isTenantLeaveAdmin(ctx.role));
  void logActivity({
    action_type: 'leave_policy_updated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { policy_id: id },
  });
}

// ── Holidays & calendars ──────────────────────────────────────────────────────
export async function listHolidays(ctx: LeaveCtx, filters: ListHolidaysInput) {
  return repo.listHolidays(ctx, filters);
}

function assertCanManageLeave(ctx: LeaveCtx) {
  if (!canManageLeave(ctx)) {
    throw new ForbiddenError('Only HR admins or org admins can manage this resource');
  }
}

export async function createHoliday(ctx: LeaveCtx, data: CreateHolidayInput) {
  assertCanManageLeave(ctx);
  return repo.createHoliday(ctx, data);
}

export async function updateHoliday(ctx: LeaveCtx, id: string, data: UpdateHolidayInput) {
  assertCanManageLeave(ctx);
  return repo.updateHoliday(ctx, id, data);
}

export async function listHolidayCalendars(ctx: LeaveCtx) {
  return repo.listHolidayCalendars(ctx);
}

export async function createHolidayCalendar(ctx: LeaveCtx, data: CreateHolidayCalendarInput) {
  assertCanManageLeave(ctx);
  return repo.createHolidayCalendar(ctx, data);
}

export async function updateHolidayCalendar(ctx: LeaveCtx, id: string, data: UpdateHolidayCalendarInput) {
  assertCanManageLeave(ctx);
  return repo.updateHolidayCalendar(ctx, id, data);
}

// ── Settings ──────────────────────────────────────────────────────────────────
export async function getSettings(ctx: LeaveCtx) {
  return repo.getEffectiveSettings(ctx);
}

export async function updateSettings(ctx: LeaveCtx, month: number, scope: 'org' | 'tenant') {
  if (scope === 'tenant') {
    if (!isTenantLeaveAdmin(ctx.role)) {
      throw new ForbiddenError('Only a tenant admin can change the tenant-wide leave cycle');
    }
  } else {
    assertCanManageLeave(ctx);
  }
  await repo.upsertSettings(ctx, month, scope);
  void logActivity({
    action_type: 'leave_settings_updated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { leave_cycle_start_month: month, scope },
  });
}
