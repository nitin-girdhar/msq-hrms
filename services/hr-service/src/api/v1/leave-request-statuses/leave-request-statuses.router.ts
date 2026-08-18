import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createLeaveRequestStatusSchema,
  updateLeaveRequestStatusSchema,
  tenantScopedQuerySchema,
} from './leave-request-statuses.schema.js';
import { LeaveRequestStatusesController } from './leave-request-statuses.controller.js';

export async function leaveRequestStatusesRouter(app: FastifyInstance) {
  const ctrl = new LeaveRequestStatusesController();

  app.get('/lookups/leave-request-statuses', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/leave-request-statuses', {
    preHandler: [authenticateSuperAdmin, validate({ body: createLeaveRequestStatusSchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/leave-request-statuses/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateLeaveRequestStatusSchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
