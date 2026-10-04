import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { upsertPayslipSchema, payrollMonthQuerySchema, type UpsertPayslipInput } from '@hr/validation';
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

  app.put('/payroll/admin/payslips', { preHandler: [authenticate, manage, validate({ body: upsertPayslipSchema })] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as UpsertPayslipInput;
    const r = await repo.upsertDraft(ctxOf(request), body);
    audit(request, 'payslip_drafted', body.user_id, { payslip_id: r.id, month: body.month });
    return reply.send({ success: true, data: r });
  });

  app.post('/payroll/admin/:month/publish', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const month = monthParam(request);
    const r = await repo.publish(ctxOf(request), month);
    audit(request, 'payslips_published', ctxOf(request).user_id, { month, count: r.published });
    return reply.send({ success: true, data: r });
  });

  app.post('/payroll/admin/:month/lock', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const month = monthParam(request);
    const r = await repo.setLock(ctxOf(request), month, true);
    audit(request, 'payroll_month_locked', ctxOf(request).user_id, { month });
    return reply.send({ success: true, data: r });
  });

  app.post('/payroll/admin/:month/unlock', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const month = monthParam(request);
    const r = await repo.setLock(ctxOf(request), month, false);
    audit(request, 'payroll_month_unlocked', ctxOf(request).user_id, { month });
    return reply.send({ success: true, data: r });
  });
}
