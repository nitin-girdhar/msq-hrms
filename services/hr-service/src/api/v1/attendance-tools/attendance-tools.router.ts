import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, type DrizzleTx } from '@platform/db';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { BadRequestError, NotFoundError } from '../../../lib/errors.js';
import { assertPeriodOpen } from '../../../lib/payroll/payroll.js';
import { recomputeAttendance } from '../attendance/attendance.repository.js';
import {
  manualPunchSchema,
  bulkRegularizeSchema,
  nudgeSchema,
  punchLogQuerySchema,
  type ManualPunchInput,
  type BulkRegularizeInput,
  type NudgeInput,
} from '@hr/validation';

// ─────────────────────────────────────────────────────────────────────────────
// Attendance tools (schema 1.64.0):
//   GET  /attendance/me/punches      the caller's own punch log with geofence/face detail
//   GET  /attendance/me/nudges       reminders HR sent the caller today
//   POST /attendance/admin/manual-punch      add a missed punch on someone's behalf
//   POST /attendance/admin/bulk-regularize   mark several people's day with one status
//   POST /attendance/admin/nudge             remind people who have not punched
//
// The three admin routes need hr.attendance.admin.override, run in the service transaction,
// are fenced to the caller's org, honour the payroll month lock, and EVERY use writes an
// audit row per person. A manual punch is stored with source 'manual' and the reason and
// acting user in device_info, so it can never be mistaken for a client punch.
// ─────────────────────────────────────────────────────────────────────────────

function ctxOf(request: FastifyRequest) {
  const { org_id, user_id, role, tenant_id, rank, capabilities } = request.auth;
  return { org_id, user_id, role, tenant_id, rank, capabilities, readOnly: !can(request.auth, CAPABILITY.PLATFORM_WRITE) };
}
const audit = (request: FastifyRequest, action: string, subject: string, extra?: Record<string, unknown>) =>
  void logActivity({ action_type: action, performed_by: request.auth.user_id, subject_user_id: subject, org_id: request.auth.org_id, ...(extra ? { new_value: extra } : {}) });

const inOrg = async (tx: DrizzleTx, orgId: string, ids: string[]): Promise<Set<string>> => {
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await tx.execute(sql`
    SELECT user_id::text AS id FROM hr.employee_profiles WHERE org_id = ${orgId} AND NOT is_deleted AND is_active AND user_id IN (${list})
  `)) as unknown as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
};

const todayUtc = () => new Date().toISOString().slice(0, 10);

export async function attendanceToolsRouter(app: FastifyInstance) {
  const view = requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW);
  const override = requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_OVERRIDE, 'You do not have permission to correct attendance on behalf of others');

  // ── Own punch log ─────────────────────────────────────────────────────────
  app.get('/attendance/me/punches', { preHandler: [authenticate, view, validate({ query: punchLogQuerySchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const { month } = request.query as { month: string };
    // RLS already limits attendance_events to the caller's own rows; the user filter repeats it.
    const data = await withRoleTx(c, async (tx) =>
      tx.execute(sql`
        SELECT e.id::text, e.event_type, e.occurred_at::text AS occurred_at, e.source,
               e.distance_from_org_m, e.is_within_geofence, e.is_wfh, e.geo_exception_type,
               e.face_match_score, e.face_match_passed, e.face_review_status, e.is_off_segment
        FROM hr.attendance_events e
        WHERE e.user_id = ${c.user_id}
          AND e.occurred_at >= (${month} || '-01')::date - INTERVAL '1 day'
          AND e.occurred_at <  ((${month} || '-01')::date + INTERVAL '1 month' + INTERVAL '1 day')
        ORDER BY e.occurred_at DESC LIMIT 500`),
    );
    return reply.send({ success: true, data });
  });

  app.get('/attendance/me/nudges', { preHandler: [authenticate, view] }, async (request, reply) => {
    const c = ctxOf(request);
    // Audit rows are service-readable only here, scoped to the verified caller and to today.
    const data = await withServiceTx(async (tx) =>
      tx.execute(sql`
        SELECT a.id::text, p.full_name AS from_name, a.created_at::text AS created_at, a.meta->'new_value'->>'work_date' AS work_date
        FROM audit.activities a LEFT JOIN iam.users p ON p.id = a.performed_by
        WHERE a.action_type = 'attendance_nudge' AND a.target_id = ${c.user_id} AND a.org_id = ${c.org_id}
          AND a.created_at >= date_trunc('day', now() - INTERVAL '1 day')
        ORDER BY a.created_at DESC LIMIT 5`),
    );
    return reply.send({ success: true, data });
  });

  // ── Manual punch ──────────────────────────────────────────────────────────
  app.post('/attendance/admin/manual-punch', { preHandler: [authenticate, override, validate({ body: manualPunchSchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const b = request.body as ManualPunchInput;
    const at = new Date(b.occurred_at);
    if (at.getTime() > Date.now()) throw new BadRequestError('A punch cannot be in the future');
    if (Date.now() - at.getTime() > 60 * 86_400_000) throw new BadRequestError('Punches older than 60 days cannot be added');

    const workDate = await withServiceTx(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${c.user_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${c.org_id}, true)`);
      if (!(await inOrg(tx, c.org_id, [b.user_id])).has(b.user_id)) throw new NotFoundError('Employee not found');
      if (b.user_id === c.user_id) throw new BadRequestError('You cannot add a punch to your own attendance');
      const d = (await tx.execute(sql`
        SELECT (${b.occurred_at}::timestamptz AT TIME ZONE o.timezone)::date::text AS d FROM entity.organizations o WHERE o.id = ${c.org_id}
      `)) as unknown as Array<{ d: string }>;
      const date = d[0]!.d;
      await assertPeriodOpen(tx, c.org_id, date);
      await tx.execute(sql`
        INSERT INTO hr.attendance_events (user_id, org_id, event_type, occurred_at, source, device_info)
        VALUES (${b.user_id}, ${c.org_id}, ${b.event_type}, ${b.occurred_at}::timestamptz, 'manual',
                ${JSON.stringify({ manual: true, reason: b.reason, added_by: c.user_id })}::jsonb)`);
      return date;
    });
    // Re-derive the day from its punches, exactly as the nightly job and a recompute would.
    await recomputeAttendance(c, { user_id: b.user_id, from: workDate, to: workDate });
    audit(request, 'attendance_manual_punch', b.user_id, { event_type: b.event_type, work_date: workDate });
    return reply.status(201).send({ success: true, data: { work_date: workDate } });
  });

  // ── Bulk regularize ───────────────────────────────────────────────────────
  app.post('/attendance/admin/bulk-regularize', { preHandler: [authenticate, override, validate({ body: bulkRegularizeSchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const b = request.body as BulkRegularizeInput;
    if (b.work_date > todayUtc()) throw new BadRequestError('You can only regularize today or a past day');
    const ids = [...new Set(b.user_ids)];

    const results = await withServiceTx(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${c.user_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${c.org_id}, true)`);
      await assertPeriodOpen(tx, c.org_id, b.work_date);
      const st = (await tx.execute(sql`
        SELECT id::text FROM hr.attendance_statuses WHERE tenant_id = ${c.tenant_id} AND name = ${b.status_name}
      `)) as unknown as Array<{ id: string }>;
      if (!st[0]) throw new BadRequestError(`Unknown attendance status: ${b.status_name}`);
      const valid = await inOrg(tx, c.org_id, ids);
      const out: Array<{ user_id: string; ok: boolean; error?: string }> = [];
      for (const id of ids) {
        // Nobody decides their own attendance, same as manual punch and regularization approval.
        if (id === c.user_id) { out.push({ user_id: id, ok: false, error: 'You cannot regularize your own attendance' }); continue; }
        if (!valid.has(id)) { out.push({ user_id: id, ok: false, error: 'Not an active employee in this branch' }); continue; }
        // The same write an approved regularization makes: the day is stamped 'regularization'
        // and every review flag is cleared, since a person decided it.
        await tx.execute(sql`
          INSERT INTO hr.attendance_days
            (user_id, org_id, work_date, status_id, has_off_window_punch, has_open_session, has_pending_face_review, resolved_at, resolution_source)
          VALUES (${id}, ${c.org_id}, ${b.work_date}::date, ${st[0]!.id}, FALSE, FALSE, FALSE, CLOCK_TIMESTAMP(), 'regularization')
          ON CONFLICT (user_id, work_date) DO UPDATE SET
            status_id = EXCLUDED.status_id, has_off_window_punch = FALSE, has_open_session = FALSE,
            has_pending_face_review = FALSE, resolved_at = CLOCK_TIMESTAMP(), resolution_source = 'regularization', updated_at = CLOCK_TIMESTAMP()`);
        out.push({ user_id: id, ok: true });
      }
      return out;
    });
    for (const r of results.filter((x) => x.ok)) {
      audit(request, 'attendance_bulk_regularized', r.user_id, { work_date: b.work_date, status: b.status_name, reason: b.reason });
    }
    const succeeded = results.filter((r) => r.ok).length;
    return reply.send({ success: true, data: { requested: ids.length, succeeded, failed: ids.length - succeeded, results } });
  });

  // ── Nudge ─────────────────────────────────────────────────────────────────
  // A nudge is a recorded reminder: the audit row IS the message, shown to the person as a
  // banner on their Home screen (GET /attendance/me/nudges). Only people who really have not
  // punched that day are nudged, so a stale list cannot pester someone who already has.
  app.post('/attendance/admin/nudge', { preHandler: [authenticate, override, validate({ body: nudgeSchema })] }, async (request, reply) => {
    const c = ctxOf(request);
    const b = request.body as NudgeInput;
    const ids = [...new Set(b.user_ids)];
    const sent = await withServiceTx(async (tx) => {
      const valid = await inOrg(tx, c.org_id, ids);
      const list = sql.join([...valid].map((i) => sql`${i}::uuid`), sql`, `);
      if (valid.size === 0) return [] as string[];
      const punched = new Set(((await tx.execute(sql`
        SELECT DISTINCT e.user_id::text AS id FROM hr.attendance_events e
        JOIN entity.organizations o ON o.id = e.org_id
        WHERE e.org_id = ${c.org_id} AND e.user_id IN (${list}) AND (e.occurred_at AT TIME ZONE o.timezone)::date = ${b.work_date}::date
      `)) as unknown as Array<{ id: string }>).map((r) => r.id));
      return [...valid].filter((id) => !punched.has(id) && id !== c.user_id);
    });
    for (const id of sent) audit(request, 'attendance_nudge', id, { work_date: b.work_date });
    return reply.send({ success: true, data: { requested: ids.length, nudged: sent.length } });
  });
}
