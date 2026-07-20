import type { FastifyInstance } from 'fastify';
import { resolveMemberRole } from '@platform/db';
import { authenticate } from '../../../middleware/auth.middleware.js';

// The caller's resolved HR product role/rank (hr.member_roles) for their
// current org — distinct from request.auth.role/rank, which the shared auth
// middleware repurposes to carry platform_role + HR rank for withRoleTx /
// isTenantLeaveAdmin (see middleware/auth.middleware.ts). Frontends use this
// to gate HR-admin-only UI (Leave/Attendance "Admin" tabs) against the same
// authority the backend actually enforces, instead of the platform/session
// rank (a different, coincidentally-overlapping scale — see P1.3).
export async function meRouter(app: FastifyInstance) {
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const { user_id, org_id } = request.auth;
    const { role, rank } = await resolveMemberRole('hr', user_id, org_id);
    return reply.send({ success: true, data: { role, rank } });
  });
}
