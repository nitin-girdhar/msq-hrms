import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './designations.service.js';
import type { DesignationCtx } from './designations.repository.js';
import type { CreateDesignationInput, UpdateDesignationInput, OrgScopedQuery } from './designations.schema.js';

function designationCtx(request: FastifyRequest): DesignationCtx {
  const { org_id, tenant_id } = request.query as OrgScopedQuery;
  return { tenantId: tenant_id, orgId: org_id, actorUserId: request.auth.user_id };
}

export class DesignationsController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.list(designationCtx(request));
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.create(designationCtx(request), request.body as CreateDesignationInput);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const data = await service.update(designationCtx(request), id, request.body as UpdateDesignationInput);
    return reply.send({ success: true, data });
  };
}
