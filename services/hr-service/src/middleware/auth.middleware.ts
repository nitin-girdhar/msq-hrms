import type { FastifyRequest } from 'fastify';
import { readAuthContext } from '@platform/service-auth';
import { resolveGlobalRole, capabilitiesFor } from '@platform/db';
import { hasOrgAccess } from '@platform/rbac';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  const { org_id, user_id, tenant_id, platform_role } = result.auth;

  // Tier C: rank + department come from the ONE iam ladder, so the HR page
  // guards and this service read the same number (they used to disagree, which
  // is why /attendance/team rendered and then 403'd on every call).
  //
  // There is NO rank floor beyond membership: every employee uses HR self-service
  // (check-in, own leave) regardless of rank, and the capability gates do the
  // denying. But the user must hold an ACTIVE role in this org — someone with no
  // mapping here is not an employee of it and reaches nothing (same rule as
  // leads-service and tasks-service). `role` carries platform_role
  // for withRoleTx PG-role selection + isTenantLeaveAdmin.
  const { role: role_name, rank, department } = await resolveGlobalRole(user_id, org_id);
  if (!hasOrgAccess(rank)) {
    throw new ForbiddenError('You do not have an active role in this organization');
  }

  // Tier C3: what this role may do comes from iam.role_capabilities. The
  // elevated HR gates read this list instead of comparing ranks.
  const capabilities = await capabilitiesFor(tenant_id, role_name);

  request.auth = {
    org_id, user_id, tenant_id,
    role: platform_role, role_name, rank, department, capabilities,
  };
}
