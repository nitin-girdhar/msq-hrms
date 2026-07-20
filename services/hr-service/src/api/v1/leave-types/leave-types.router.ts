import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  tenantScopedQuerySchema,
} from './leave-types.schema.js';
import { LeaveTypesController } from './leave-types.controller.js';

export async function leaveTypesRouter(app: FastifyInstance) {
  const ctrl = new LeaveTypesController();

  app.get('/lookups/leave-types', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/leave-types', {
    preHandler: [authenticateSuperAdmin, validate({ body: createLeaveTypeSchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/leave-types/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateLeaveTypeSchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
