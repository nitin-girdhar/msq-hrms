import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createEmploymentTypeSchema,
  updateEmploymentTypeSchema,
  tenantScopedQuerySchema,
} from './employment-types.schema.js';
import { EmploymentTypesController } from './employment-types.controller.js';

export async function employmentTypesRouter(app: FastifyInstance) {
  const ctrl = new EmploymentTypesController();

  app.get('/lookups/employment-types', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/employment-types', {
    preHandler: [authenticateSuperAdmin, validate({ body: createEmploymentTypeSchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/employment-types/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateEmploymentTypeSchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
