import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createAttendanceStatusSchema,
  updateAttendanceStatusSchema,
  tenantScopedQuerySchema,
} from './attendance-statuses.schema.js';
import { AttendanceStatusesController } from './attendance-statuses.controller.js';

export async function attendanceStatusesRouter(app: FastifyInstance) {
  const ctrl = new AttendanceStatusesController();

  app.get('/lookups/attendance-statuses', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/attendance-statuses', {
    preHandler: [authenticateSuperAdmin, validate({ body: createAttendanceStatusSchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/attendance-statuses/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateAttendanceStatusSchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
