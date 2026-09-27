import type { FastifyInstance } from 'fastify';
import { validate } from '../../../middleware/validate.middleware.js';
import { authenticateInternal } from './internal.auth.js';
import { syncEmployeeProfileSchema } from './internal.schema.js';
import { InternalController } from './internal.controller.js';

const ctrl = new InternalController();

export async function internalRouter(app: FastifyInstance) {
  // Called by identity-service when Admin → Team creates a member, moves their
  // home branch, or (de)activates them. hr.employee_profiles is HR-owned data
  // (N-5), so identity invokes hr-service rather than writing hr.* itself.
  // Deliberately absent from the api-gateway allowlist (see the EXEMPT entry in
  // __tests__/gateway-route-coverage.test.ts).
  app.post(
    '/internal/employees/sync',
    { preHandler: [authenticateInternal, validate({ body: syncEmployeeProfileSchema })] },
    ctrl.syncEmployeeProfile,
  );
}
