import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createHolidaySchema, updateHolidaySchema, orgScopedQuerySchema } from './holidays.schema.js';
import { HolidaysController } from './holidays.controller.js';

export async function holidaysRouter(app: FastifyInstance) {
  const ctrl = new HolidaysController();

  app.get('/lookups/holidays', { preHandler: [authenticateSuperAdmin, validate({ query: orgScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/holidays', {
    preHandler: [authenticateSuperAdmin, validate({ body: createHolidaySchema, query: orgScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/holidays/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateHolidaySchema, query: orgScopedQuerySchema })],
  }, ctrl.update);
}
