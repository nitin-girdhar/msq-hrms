import type { FastifyInstance } from 'fastify';
import { resolveGlobalRole } from '@platform/db';
import { authenticate } from '../../../middleware/auth.middleware.js';

// The caller's resolved role/rank/department for their current org, from the ONE
// iam ladder (Tier C). Frontends use this to gate HR-admin-only UI (Leave /
// Attendance "Admin" tabs) against exactly the authority the backend enforces.
//
// Before Tier C this returned the hr.member_roles rank while the page guards used
// the platform/session rank — two different scales that drifted apart, which is
// why the Team tabs rendered and then 403'd on every call. There is now a single
// scale, so this endpoint and the guards cannot disagree.
export async function meRouter(app: FastifyInstance) {
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const { user_id, org_id } = request.auth;
    const { role, rank, department } = await resolveGlobalRole(user_id, org_id);
    return reply.send({ success: true, data: { role, rank, department } });
  });
}
