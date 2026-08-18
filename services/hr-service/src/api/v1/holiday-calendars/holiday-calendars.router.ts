import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createHolidayCalendarSchema,
  updateHolidayCalendarSchema,
  orgScopedQuerySchema,
} from './holiday-calendars.schema.js';
import { HolidayCalendarsController } from './holiday-calendars.controller.js';

export async function holidayCalendarsRouter(app: FastifyInstance) {
  const ctrl = new HolidayCalendarsController();

  app.get('/lookups/holiday-calendars', { preHandler: [authenticateSuperAdmin, validate({ query: orgScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/holiday-calendars', {
    preHandler: [authenticateSuperAdmin, validate({ body: createHolidayCalendarSchema, query: orgScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/holiday-calendars/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateHolidayCalendarSchema, query: orgScopedQuerySchema })],
  }, ctrl.update);
}
