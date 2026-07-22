import type { FastifyRequest } from 'fastify';
import { readAuthContext } from '@platform/service-auth';
import { resolveGlobalRole, capabilitiesFor } from '@platform/db';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  const { org_id, user_id, tenant_id, platform_role } = result.auth;

  // Tier C: rank + department come from the ONE iam ladder, so the HR page
  // guards and this service read the same number (they used to disagree, which
  // is why /attendance/team rendered and then 403'd on every call).
  //
  // Unlike LMS there is deliberately NO membership gate here: every employee uses
  // HR self-service (check-in, own leave) regardless of rank. The elevated HR
  // gates (canManage*/canViewTeam*) do the denying. `role` carries platform_role
  // for withRoleTx PG-role selection + isTenantLeaveAdmin.
  const { role: role_name, rank, department } = await resolveGlobalRole(user_id, org_id);

  // Tier C3: what this role may do comes from iam.role_capabilities. Still no
  // membership gate for the reason above — self-service is universal — but the
  // elevated HR gates below now read this list instead of comparing ranks.
  const capabilities = await capabilitiesFor(tenant_id, role_name);

  request.auth = {
    org_id, user_id, tenant_id,
    role: platform_role, role_name, rank, department, capabilities,
  };
}
