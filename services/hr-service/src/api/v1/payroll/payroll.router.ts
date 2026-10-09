import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { upsertPayslipSchema, payrollMonthQuerySchema, type UpsertPayslipInput } from '@hr/validation';
import { monthStart } from '../../../lib/payroll/payroll.js';
import * as repo from './payroll.repository.js';

// Payroll viewer (schema 1.62.0). Small enough that router + handlers + audit live in
// one file; the rules and SQL are in lib/payroll and payroll.repository.
function ctxOf(request: FastifyRequest) {
  const { org_id, user_id, role, tenant_id } = request.auth;
  return { org_id, user_id, role, tenant_id, readOnly: !can(request.auth, CAPABILITY.PLATFORM_WRITE) };
}
const audit = (request: FastifyRequest, action: string, subject: string, extra?: Record<string, unknown>) => {
  const c = ctxOf(request);
  // Amounts are never written to the audit log -- it records THAT a payslip was touched.
  void logActivity({ action_type: action, performed_by: c.user_id, subject_user_id: subject, org_id: c.org_id, ...(extra ? { new_value: extra } : {}) });
};

export async function payrollRouter(app: FastifyInstance) {
  const view = requireCapability(CAPABILITY.HR_EMPLOYEES_PAYSLIP_VIEW);
  const manage = requireCapability(CAPABILITY.HR_REPORTS_PAYROLL_MANAGE, 'You do not have permission to manage payroll');
  const monthParam = (request: FastifyRequest) => (request.params as { month: string }).month;

  app.get('/payroll/payslips', { preHandler: [authenticate, view] }, async (request, reply) =>
    reply.send({ success: true, data: await repo.listOwn(ctxOf(request)) }));

  app.get('/payroll/payslips/:id', { preHandler: [authenticate, view] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ success: true, data: await repo.getOwn(ctxOf(request), id) });
  });

  app.get('/payroll/admin/overview', { preHandler: [authenticate, manage, validate({ query: payrollMonthQuerySchema })] }, async (request, reply) => {
    const { month } = request.query as { month: string };
    return reply.send({ success: true, data: await repo.overview(ctxOf(request), month) });
  });

  // Month-end checklist: what is still open before this month can be handed to payroll. Counts
  // only (no names, no amounts), org-fenced, behind the payroll-manage capability.
  app.get('/payroll/admin/readiness', { preHandler: [authenticate, manage, validate({ query: payrollMonthQuerySchema })] }, async (request, reply) => {
    const { month } = request.query as { month: string };
    const c = ctxOf(request);
    const period = monthStart(month);
    const data = await withServiceTx(async (tx) => {
      const one = async (q: ReturnType<typeof sql>) => ((await tx.execute(q)) as unknown as Array<{ n: number }>)[0]?.n ?? 0;
      const per = (await tx.execute(sql`
        SELECT status, locked_at::text AS locked_at FROM hr.pay_periods
        WHERE org_id = ${c.org_id} AND period = ${period}::date AND NOT is_deleted`)) as unknown as Array<{ status: string; locked_at: string | null }>;
      const end = sql`(${period}::date + INTERVAL '1 month')::date`;
      return {
        month,
        status: per[0]?.status ?? 'open',
        locked_at: per[0]?.locked_at ?? null,
        headcount: await one(sql`SELECT count(*)::int AS n FROM hr.employee_profiles WHERE org_id = ${c.org_id} AND is_active AND NOT is_deleted`),
        pending_regularizations: await one(sql`
          SELECT count(*)::int AS n FROM hr.attendance_regularizations
          WHERE org_id = ${c.org_id} AND status = 'pending' AND NOT is_deleted AND work_date >= ${period}::date AND work_date < ${end}`),
        pending_leave: await one(sql`
          SELECT count(*)::int AS n FROM hr.leave_requests lr JOIN hr.leave_request_statuses s ON s.id = lr.status_id
          WHERE lr.org_id = ${c.org_id} AND s.name = 'pending' AND NOT lr.is_deleted
            AND lr.start_date < ${end} AND lr.end_date >= ${period}::date`),
        missed_punch_days: await one(sql`
          SELECT count(*)::int AS n FROM hr.attendance_days d JOIN hr.attendance_statuses s ON s.id = d.status_id
          WHERE d.org_id = ${c.org_id} AND s.name = 'missed_punch' AND d.work_date >= ${period}::date AND d.work_date < ${end}`),
        draft_payslips: await one(sql`
          SELECT count(*)::int AS n FROM hr.payslips WHERE org_id = ${c.org_id} AND period = ${period}::date AND published_at IS NULL AND NOT is_deleted`),
        published_payslips: await one(sql`
          SELECT count(*)::int AS n FROM hr.payslips WHERE org_id = ${c.org_id} AND period = ${period}::date AND published_at IS NOT NULL AND NOT is_deleted`),
      };
    });
    return reply.send({ success: true, data });
  });

  app.put('/payroll/admin/payslips', { preHandler: [authenticate, manage, validate({ body: upsertPayslipSchema })] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as UpsertPayslipInput;
    const r = await repo.upsertDraft(ctxOf(request), body);
    audit(request, 'payslip_drafted', body.user_id, { payslip_id: r.id, month: body.month });
    return reply.send({ success: true, data: r });
  });

  app.post('/payroll/admin/:month/publish', { preHandler: [authenticate, manage, validate({ params: payrollMonthQuerySchema })] }, async (request, reply) => {
    const month = monthParam(request);
    const r = await repo.publish(ctxOf(request), month);
    audit(request, 'payslips_published', ctxOf(request).user_id, { month, count: r.published });
    return reply.send({ success: true, data: r });
  });

  app.post('/payroll/admin/:month/lock', { preHandler: [authenticate, manage, validate({ params: payrollMonthQuerySchema })] }, async (request, reply) => {
    const month = monthParam(request);
    const r = await repo.setLock(ctxOf(request), month, true);
    audit(request, 'payroll_month_locked', ctxOf(request).user_id, { month });
    return reply.send({ success: true, data: r });
  });

  app.post('/payroll/admin/:month/unlock', { preHandler: [authenticate, manage, validate({ params: payrollMonthQuerySchema })] }, async (request, reply) => {
    const month = monthParam(request);
    const r = await repo.setLock(ctxOf(request), month, false);
    audit(request, 'payroll_month_unlocked', ctxOf(request).user_id, { month });
    return reply.send({ success: true, data: r });
  });
}
