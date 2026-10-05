import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { resolveGlobalRole, withServiceTx } from '@platform/db';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';

// The caller's resolved role/rank/department for their current org, from the ONE
// iam ladder (Tier C). Frontends use this to gate HR-admin-only UI (Leave /
// Attendance "Admin" tabs) against exactly the authority the backend enforces.
//
// Before Tier C this returned the hr.member_roles rank while the page guards used
// the platform/session rank — two different scales that drifted apart, which is
// why the Team tabs rendered and then 403'd on every call. There is now a single
// scale, so this endpoint and the guards cannot disagree.
export async function meRouter(app: FastifyInstance) {
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const { user_id, org_id } = request.auth;
    const { role, rank, department } = await resolveGlobalRole(user_id, org_id);
    return reply.send({ success: true, data: { role, rank, department } });
  });

  // The caller's own recent activity for the dashboard: punches, leave decisions, regularization
  // decisions, published payslips and reviewed documents, newest first. Strictly the caller's rows
  // (user and org come from request.auth), and each source is read only if the caller holds the
  // capability behind its screen. Titles are labels, never document content or amounts.
  app.get('/me/activity', { preHandler: [authenticate] }, async (request, reply) => {
    const { user_id, org_id } = request.auth;
    const LIMIT = 10;
    type Row = { kind: string; title: string; detail: string | null; at: string; href: string };
    const wantAttendance = can(request.auth, CAPABILITY.HR_ATTENDANCE_VIEW);
    const wantLeave = can(request.auth, CAPABILITY.HR_LEAVE_VIEW);
    const wantPayslips = can(request.auth, CAPABILITY.HR_EMPLOYEES_PAYSLIP_VIEW);
    const wantDocs = can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW);
    const rows = await withServiceTx(async (tx) => {
      const out: Row[] = [];
      const run = async (q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Row[];
      if (wantAttendance) {
        out.push(...await run(sql`
          SELECT 'punch' AS kind, CASE e.event_type WHEN 'check_in' THEN 'Checked in' ELSE 'Checked out' END AS title,
                 e.source AS detail, e.occurred_at::text AS at, '/attendance' AS href
          FROM hr.attendance_events e WHERE e.user_id = ${user_id} AND e.org_id = ${org_id}
          ORDER BY e.occurred_at DESC LIMIT ${LIMIT}`));
        out.push(...await run(sql`
          SELECT 'regularization' AS kind, 'Regularization ' || r.status AS title, r.work_date::text AS detail,
                 COALESCE(r.acted_at, r.created_at)::text AS at, '/attendance' AS href
          FROM hr.attendance_regularizations r
          WHERE r.user_id = ${user_id} AND r.org_id = ${org_id} AND NOT r.is_deleted
          ORDER BY COALESCE(r.acted_at, r.created_at) DESC LIMIT ${LIMIT}`));
      }
      if (wantLeave) {
        out.push(...await run(sql`
          SELECT 'leave' AS kind, 'Leave request ' || lower(st.label) AS title,
                 lr.start_date::text || CASE WHEN lr.end_date <> lr.start_date THEN ' to ' || lr.end_date::text ELSE '' END AS detail,
                 l.changed_at::text AS at, '/leave' AS href
          FROM hr.leave_request_status_log l
          JOIN hr.leave_requests lr ON lr.id = l.request_id
          JOIN hr.leave_request_statuses st ON st.id = l.new_status_id
          WHERE lr.user_id = ${user_id} AND lr.org_id = ${org_id}
          ORDER BY l.changed_at DESC LIMIT ${LIMIT}`));
      }
      if (wantPayslips) {
        out.push(...await run(sql`
          SELECT 'payslip' AS kind, 'Payslip published' AS title, to_char(p.period, 'Mon YYYY') AS detail,
                 p.published_at::text AS at, '/payroll' AS href
          FROM hr.payslips p
          WHERE p.user_id = ${user_id} AND p.org_id = ${org_id} AND NOT p.is_deleted AND p.published_at IS NOT NULL
          ORDER BY p.published_at DESC LIMIT ${LIMIT}`));
      }
      if (wantDocs) {
        out.push(...await run(sql`
          SELECT 'document' AS kind, 'Document ' || d.status AS title, d.title AS detail, d.reviewed_at::text AS at, '/documents' AS href
          FROM hr.employee_documents d
          WHERE d.user_id = ${user_id} AND d.org_id = ${org_id} AND NOT d.is_deleted AND d.reviewed_at IS NOT NULL
          ORDER BY d.reviewed_at DESC LIMIT ${LIMIT}`));
      }
      return out;
    });
    // Postgres text timestamps ("2026-09-30 07:45:32+00") are not ISO; Safari refuses to parse them, so normalise here.
    const data = rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, LIMIT);
    return reply.send({ success: true, data });
  });
}
