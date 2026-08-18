import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './holidays.service.js';
import type { OrgCtx } from './holidays.repository.js';
import type { CreateHolidayInput, UpdateHolidayInput, OrgScopedQuery } from './holidays.schema.js';

function orgCtx(request: FastifyRequest): OrgCtx {
  const { org_id, tenant_id } = request.query as OrgScopedQuery;
  return { tenantId: tenant_id, orgId: org_id, actorUserId: request.auth.user_id };
}

export class HolidaysController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.list(orgCtx(request));
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.create(orgCtx(request), request.body as CreateHolidayInput);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const data = await service.update(orgCtx(request), id, request.body as UpdateHolidayInput);
    return reply.send({ success: true, data });
  };
}
