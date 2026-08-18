import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createShiftSchema, updateShiftSchema, orgScopedQuerySchema } from './shifts.schema.js';
import { ShiftsController } from './shifts.controller.js';

export async function shiftsRouter(app: FastifyInstance) {
  const ctrl = new ShiftsController();

  app.get('/lookups/shifts', { preHandler: [authenticateSuperAdmin, validate({ query: orgScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/shifts', {
    preHandler: [authenticateSuperAdmin, validate({ body: createShiftSchema, query: orgScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/shifts/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateShiftSchema, query: orgScopedQuerySchema })],
  }, ctrl.update);
}
