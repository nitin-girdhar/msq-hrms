import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createDesignationSchema,
  updateDesignationSchema,
  orgScopedQuerySchema,
} from './designations.schema.js';
import { DesignationsController } from './designations.controller.js';

export async function designationsRouter(app: FastifyInstance) {
  const ctrl = new DesignationsController();

  app.get('/lookups/designations', { preHandler: [authenticateSuperAdmin, validate({ query: orgScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/designations', {
    preHandler: [authenticateSuperAdmin, validate({ body: createDesignationSchema, query: orgScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/designations/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateDesignationSchema, query: orgScopedQuerySchema })],
  }, ctrl.update);
}
