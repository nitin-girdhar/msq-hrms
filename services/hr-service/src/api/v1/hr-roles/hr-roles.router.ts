import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createHrRoleSchema,
  updateHrRoleSchema,
  tenantScopedQuerySchema,
} from './hr-roles.schema.js';
import { HrRolesController } from './hr-roles.controller.js';

export async function hrRolesRouter(app: FastifyInstance) {
  const ctrl = new HrRolesController();

  app.get('/lookups/hr-roles', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/hr-roles', {
    preHandler: [authenticateSuperAdmin, validate({ body: createHrRoleSchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/hr-roles/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateHrRoleSchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
