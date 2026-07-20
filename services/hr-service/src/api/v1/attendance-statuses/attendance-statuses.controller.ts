import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import type { RoleTxContext } from '@platform/db';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './attendance-statuses.service.js';
import type {
  CreateAttendanceStatusInput,
  UpdateAttendanceStatusInput,
  TenantScopedQuery,
} from './attendance-statuses.schema.js';

function tenantCtx(request: FastifyRequest): RoleTxContext {
  const { tenant_id } = request.query as TenantScopedQuery;
  return { role: 'super_admin', org_id: '', user_id: request.auth.user_id, tenant_id };
}

export class AttendanceStatusesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.list(tenantCtx(request));
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.create(tenantCtx(request), request.body as CreateAttendanceStatusInput);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const data = await service.update(tenantCtx(request), id, request.body as UpdateAttendanceStatusInput);
    return reply.send({ success: true, data });
  };
}
