import type { FastifyInstance } from 'fastify';
import { getActiveTenantModules } from '@platform/db';
import { authenticate } from '../../../middleware/auth.middleware.js';

// Small, read-only endpoint: which entity.tenant_modules are active for the
// caller's tenant. Tenant is derived strictly from the gateway-verified
// request.auth context (never a client-supplied id) — same pattern as
// requireModule's resolveActiveModules. Drives the module nav switcher in
// apps/web; not module-gated itself (you need this to know what to gate).
export async function modulesRouter(app: FastifyInstance) {
  app.get('/modules', { preHandler: [authenticate] }, async (request, reply) => {
    const { role, org_id, tenant_id, user_id } = request.auth;
    const modules = await getActiveTenantModules({ role, org_id, tenant_id, user_id });
    return reply.send({ success: true, data: { modules } });
  });
}
