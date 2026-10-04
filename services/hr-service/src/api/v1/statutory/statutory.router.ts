import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, pgErrorCode, type DrizzleTx } from '@platform/db';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import { changedFields, maskStatutory, mergeStatutory, type StatutoryPatch, type StatutoryRow } from '../../../lib/profile/statutory.js';
import {
  statutoryFieldsSchema,
  createChangeRequestSchema,
  listChangeRequestsSchema,
  decideChangeRequestSchema,
  rejectChangeRequestSchema,
  employeeMonthQuerySchema,
  type StatutoryFieldsInput,
  type CreateChangeRequestInput,
  type ListChangeRequestsInput,
  type DecideChangeRequestInput,
  type RejectChangeRequestInput,
} from '@hr/validation';

// ─────────────────────────────────────────────────────────────────────────────
// Statutory / bank details, profile change requests, and the Employee 360 attendance,
// audit and org-chart reads (schema 1.64.0).
//
// PRIVACY. The numbers are stored as plain text for now (product decision; encryption
// later), so access control is the whole defence:
//   - the owner reads their own row under the database's self policy (withRoleTx);
//   - anyone else reads or writes through the service transaction ONLY with
//     hr.employees.statutory.manage, org-fenced, and EVERY such access writes an audit
//     row (field NAMES, never values);
//   - everyone who can merely open an Employee 360 gets the MASKED view.
// ─────────────────────────────────────────────────────────────────────────────

function ctxOf(request: FastifyRequest) {
  const { org_id, user_id, role, tenant_id } = request.auth;
  return { org_id, user_id, role, tenant_id, readOnly: !can(request.auth, CAPABILITY.PLATFORM_WRITE) };
}
const audit = (request: FastifyRequest, action: string, subject: string, extra?: Record<string, unknown>) =>
  void logActivity({ action_type: action, performed_by: request.auth.user_id, subject_user_id: subject, org_id: request.auth.org_id, ...(extra ? { new_value: extra } : {}) });

const COLS = sql`pan, aadhaar, uan, bank_name, bank_branch, account_number, ifsc, account_type, tax_regime`;

async function employeeInOrg(tx: DrizzleTx, orgId: string, userId: string): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM hr.employee_profiles WHERE user_id = ${userId} AND org_id = ${orgId} AND NOT is_deleted
  `)) as unknown as unknown[];
  // A person outside the caller's org is "not found" -- the same answer as an unknown id.
  if (rows.length === 0) throw new NotFoundError('Employee not found');
}

async function loadRow(tx: DrizzleTx, userId: string): Promise<StatutoryRow | null> {
  const rows = (await tx.execute(sql`SELECT ${COLS} FROM hr.employee_statutory WHERE user_id = ${userId} AND NOT is_deleted`)) as unknown as StatutoryRow[];
  return rows[0] ?? null;
}

async function saveRow(tx: DrizzleTx, orgId: string, userId: string, row: StatutoryRow): Promise<void> {
  await tx.execute(sql`
    INSERT INTO hr.employee_statutory
      (user_id, org_id, pan, aadhaar, uan, bank_name, bank_branch, account_number, ifsc, account_type, tax_regime)
    VALUES (${userId}, ${orgId}, ${row.pan}, ${row.aadhaar}, ${row.uan}, ${row.bank_name}, ${row.bank_branch},
            ${row.account_number}, ${row.ifsc}, ${row.account_type}, ${row.tax_regime})
    ON CONFLICT (user_id) DO UPDATE SET
      pan = EXCLUDED.pan, aadhaar = EXCLUDED.aadhaar, uan = EXCLUDED.uan, bank_name = EXCLUDED.bank_name,
      bank_branch = EXCLUDED.bank_branch, account_number = EXCLUDED.account_number, ifsc = EXCLUDED.ifsc,
      account_type = EXCLUDED.account_type, tax_regime = EXCLUDED.tax_regime, is_deleted = FALSE, is_active = TRUE`);
}

const withCtx = async <T>(request: FastifyRequest, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> => {
  const c = ctxOf(request);
  return withServiceTx(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${c.user_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${c.org_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${c.tenant_id}, true)`);
    return fn(tx);
  });
};

export async function statutoryRouter(app: FastifyInstance) {
  const edit = requireCapability(CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT);
  const manage = requireCapability(CAPABILITY.HR_EMPLOYEES_STATUTORY_MANAGE, 'You do not have permission to manage statutory details');
  const open360 = requireCapability(CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW, 'You do not have permission to open employee profiles');

  // ── Self ───────────────────────────────────────────────────────────────────
  app.get('/profile/me/statutory', { preHandler: [authenticate, edit] }, async (request, reply) => {
    const c = ctxOf(request);
    const data = await withRoleTx(c, async (tx) => loadRow(tx, c.user_id));
    return reply.send({ success: true, data });
  });

  app.get('/profile/me/change-requests', { preHandler: [authenticate, edit] }, async (request, reply) => {
    const c = ctxOf(request);
    const data = await withRoleTx(c, async (tx) =>
      tx.execute(sql`
        SELECT id::text, section, payload, reason, status, reviewer_comment, acted_at::text, created_at::text
        FROM hr.profile_change_requests WHERE user_id = ${c.user_id} AND NOT is_deleted ORDER BY created_at DESC LIMIT 50`),
    );
    return reply.send({ success: true, data });
  });

  // The requester is always request.auth.user_id; the body names only WHAT to change.
  app.post('/profile/me/change-requests', { preHandler: [authenticate, edit, validate({ body: createChangeRequestSchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const b = request.body as CreateChangeRequestInput;
    try {
      const id = await withCtx(request, async (tx) => {
        const rows = (await tx.execute(sql`
          INSERT INTO hr.profile_change_requests (user_id, org_id, section, payload, reason, created_by)
          VALUES (${c.user_id}, ${c.org_id}, 'statutory', ${JSON.stringify(b.payload)}::jsonb, ${b.reason ?? null}, ${c.user_id})
          RETURNING id::text`)) as unknown as Array<{ id: string }>;
        return rows[0]!.id;
      });
      audit(request, 'profile_change_requested', c.user_id, { request_id: id, fields: changedFields(b.payload as StatutoryPatch) });
      return reply.status(201).send({ success: true, data: { id } });
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new ConflictError('You already have a change request waiting for review');
      throw err;
    }
  });

  app.post('/profile/me/change-requests/:id/cancel', { preHandler: [authenticate, edit] }, async (request, reply) => {
    const c = ctxOf(request);
    const { id } = request.params as { id: string };
    const rows = await withCtx(request, async (tx) =>
      (await tx.execute(sql`
        UPDATE hr.profile_change_requests SET status = 'cancelled'
        WHERE id = ${id} AND user_id = ${c.user_id} AND org_id = ${c.org_id} AND status = 'pending' AND NOT is_deleted
        RETURNING id::text`)) as unknown as unknown[]);
    if (rows.length === 0) throw new NotFoundError('No pending change request found');
    return reply.status(204).send();
  });

  // ── HR: someone's statutory details ───────────────────────────────────────
  // Everyone who can open the 360 gets the masked view; only statutory.manage sees the
  // numbers, and that read is audited.
  app.get('/employees/:userId/statutory', { preHandler: [authenticate, open360] }, async (request, reply) => {
    const c = ctxOf(request);
    const { userId } = request.params as { userId: string };
    const full = can(request.auth, CAPABILITY.HR_EMPLOYEES_STATUTORY_MANAGE);
    const row = await withCtx(request, async (tx) => {
      await employeeInOrg(tx, c.org_id, userId);
      return loadRow(tx, userId);
    });
    if (full && userId !== c.user_id) audit(request, 'statutory_viewed', userId);
    return reply.send({ success: true, data: { masked: maskStatutory(row), values: full ? row : null } });
  });

  app.put('/employees/:userId/statutory', { preHandler: [authenticate, manage, validate({ body: statutoryFieldsSchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const { userId } = request.params as { userId: string };
    const patch = request.body as StatutoryFieldsInput;
    await withCtx(request, async (tx) => {
      await employeeInOrg(tx, c.org_id, userId);
      await saveRow(tx, c.org_id, userId, mergeStatutory(await loadRow(tx, userId), patch as StatutoryPatch));
    });
    audit(request, 'statutory_updated', userId, { fields: changedFields(patch as StatutoryPatch) });
    return reply.status(204).send();
  });

  // ── HR: change requests ───────────────────────────────────────────────────
  app.get('/profile/change-requests', { preHandler: [authenticate, manage, validate({ query: listChangeRequestsSchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const { status } = request.query as ListChangeRequestsInput;
    const data = await withCtx(request, async (tx) =>
      tx.execute(sql`
        SELECT r.id::text, r.user_id::text, u.full_name AS user_full_name, r.section, r.payload, r.reason, r.status,
               r.reviewer_comment, r.acted_at::text, r.created_at::text
        FROM hr.profile_change_requests r JOIN iam.users u ON u.id = r.user_id
        WHERE r.org_id = ${c.org_id} AND r.status = ${status} AND NOT r.is_deleted
        ORDER BY r.created_at DESC LIMIT 200`),
    );
    return reply.send({ success: true, data });
  });

  const decide = async (request: FastifyRequest, approve: boolean, comment: string | null) => {
    const c = ctxOf(request);
    const { id } = request.params as { id: string };
    const out = await withCtx(request, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id::text, user_id::text, payload, status FROM hr.profile_change_requests
        WHERE id = ${id} AND org_id = ${c.org_id} AND NOT is_deleted FOR UPDATE
      `)) as unknown as Array<{ id: string; user_id: string; payload: StatutoryPatch; status: string }>;
      const r = rows[0];
      if (!r) throw new NotFoundError('Change request not found');
      if (r.status !== 'pending') throw new ConflictError(`Request is already ${r.status}`);
      // Nobody decides a change to their own bank details.
      if (r.user_id === c.user_id) throw new ForbiddenError('You cannot decide your own change request');
      if (approve) {
        // Re-validate the stored payload before it touches the table: the row may predate a format rule.
        const parsed = statutoryFieldsSchema.safeParse(r.payload);
        if (!parsed.success) throw new BadRequestError('The requested values are no longer valid; ask the employee to resubmit');
        await employeeInOrg(tx, c.org_id, r.user_id);
        await saveRow(tx, c.org_id, r.user_id, mergeStatutory(await loadRow(tx, r.user_id), parsed.data as StatutoryPatch));
      }
      await tx.execute(sql`
        UPDATE hr.profile_change_requests
        SET status = ${approve ? 'approved' : 'rejected'}, reviewer_id = ${c.user_id}, acted_at = CLOCK_TIMESTAMP(), reviewer_comment = ${comment}
        WHERE id = ${id}`);
      return { user_id: r.user_id, fields: changedFields(r.payload) };
    });
    audit(request, approve ? 'profile_change_approved' : 'profile_change_rejected', out.user_id, { request_id: id, fields: out.fields });
  };

  app.post('/profile/change-requests/:id/approve', { preHandler: [authenticate, manage, validate({ body: decideChangeRequestSchema })] }, async (request, reply) => {
    await decide(request, true, (request.body as DecideChangeRequestInput).comment ?? null);
    return reply.status(204).send();
  });
  app.post('/profile/change-requests/:id/reject', { preHandler: [authenticate, manage, validate({ body: rejectChangeRequestSchema })] }, async (request, reply) => {
    await decide(request, false, (request.body as RejectChangeRequestInput).comment);
    return reply.status(204).send();
  });

  // ── Employee 360: attendance tab ──────────────────────────────────────────
  app.get('/employees/:userId/attendance', { preHandler: [authenticate, open360, validate({ query: employeeMonthQuerySchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const { userId } = request.params as { userId: string };
    const { month } = request.query as { month: string };
    const data = await withCtx(request, async (tx) => {
      await employeeInOrg(tx, c.org_id, userId);
      return tx.execute(sql`
        SELECT d.work_date::text AS work_date, s.name AS status_name, s.label AS status_label,
               d.first_in::text AS first_in, d.last_out::text AS last_out, d.worked_minutes,
               d.is_late, d.is_early_exit, d.has_open_session
        FROM hr.attendance_days d JOIN hr.attendance_statuses s ON s.id = d.status_id
        WHERE d.user_id = ${userId} AND d.org_id = ${c.org_id}
          AND d.work_date >= (${month} || '-01')::date AND d.work_date < ((${month} || '-01')::date + INTERVAL '1 month')
        ORDER BY d.work_date`);
    });
    return reply.send({ success: true, data });
  });

  // ── Employee 360: audit trail ─────────────────────────────────────────────
  // Who did what ABOUT this person. Action names, actors and times only: never the old/new
  // values. Needs the HR-notes capability because the trail includes HR-only actions.
  app.get('/employees/:userId/audit', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_NOTES_MANAGE, 'You do not have permission to view the audit trail')],
  }, async (request, reply) => {
    const c = ctxOf(request);
    const { userId } = request.params as { userId: string };
    const data = await withCtx(request, async (tx) => {
      await employeeInOrg(tx, c.org_id, userId);
      return tx.execute(sql`
        SELECT a.id::text, a.action_type, p.full_name AS performed_by_name, a.created_at::text AS created_at
        FROM audit.activities a LEFT JOIN iam.users p ON p.id = a.performed_by
        WHERE a.target_id = ${userId} AND a.target_type = 'user' AND a.org_id = ${c.org_id}
          AND a.action_type !~ '^(login|logout|account_|password)'
        ORDER BY a.created_at DESC LIMIT 100`);
    });
    return reply.send({ success: true, data });
  });

  // ── Org chart ─────────────────────────────────────────────────────────────
  // Name, title and reporting line of the people in the caller's branch. Same audience as the
  // employee directory (hr.employees.view); no personal or pay data.
  app.get('/employees/org-chart', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_VIEW)] }, async (request, reply) => {
    const c = ctxOf(request);
    const data = await withCtx(request, async (tx) =>
      tx.execute(sql`
        SELECT u.id::text AS user_id, u.full_name, u.manager_id::text AS manager_id,
               ds.name AS designation_name, d.name AS department_name
        FROM hr.employee_profiles ep
        JOIN iam.users u ON u.id = ep.user_id
        LEFT JOIN hr.designations ds ON ds.id = ep.designation_id
        LEFT JOIN iam.departments d ON d.id = ep.department_id
        WHERE ep.org_id = ${c.org_id} AND NOT ep.is_deleted AND ep.is_active AND u.is_active
        ORDER BY u.full_name LIMIT 1000`),
    );
    return reply.send({ success: true, data });
  });
}
