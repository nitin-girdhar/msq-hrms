import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import type { RoleTxContext } from '@platform/db';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './hr-roles.service.js';
import type {
  CreateHrRoleInput,
  UpdateHrRoleInput,
  TenantScopedQuery,
} from './hr-roles.schema.js';

function tenantCtx(request: FastifyRequest): RoleTxContext {
  const { tenant_id } = request.query as TenantScopedQuery;
  return { role: 'super_admin', org_id: '', user_id: request.auth.user_id, tenant_id };
}

export class HrRolesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.list(tenantCtx(request));
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.create(tenantCtx(request), request.body as CreateHrRoleInput);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const data = await service.update(tenantCtx(request), id, request.body as UpdateHrRoleInput);
    return reply.send({ success: true, data });
  };
}
