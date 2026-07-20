import type { FastifyRequest } from 'fastify';
import { readAuthContext } from '@platform/service-auth';
import { resolveMemberRole } from '@platform/db';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  const { org_id, user_id, tenant_id, platform_role } = result.auth;

  // P1.3: resolve the acting user's HR role/rank from hr.member_roles server-side
  // (never a header). Unlike LMS, HR membership is NOT required to be here: every
  // employee uses HR self-service (check-in, own leave/attendance) with no HR
  // management grant — hr.member_roles only confers elevated authority. So a
  // missing grant resolves to rank -1 (not a 403); the HR authz gates
  // (canManage*/canViewTeam*) then correctly deny elevated actions. `role`
  // carries platform_role for withRoleTx PG-role selection + isTenantLeaveAdmin.
  const { rank } = await resolveMemberRole('hr', user_id, org_id);
  request.auth = { org_id, user_id, tenant_id, role: platform_role, rank };
}
