import type { FastifyRequest, FastifyReply } from 'fastify';
import { can, CAPABILITY } from '@platform/rbac';
import * as service from './swaps.service.js';
import type {
  CreateShiftSwapInput,
  DecideShiftSwapInput,
  RejectShiftSwapInput,
  RespondShiftSwapInput,
  RosterQueryInput,
} from './swaps.schema.js';

function ctxOf(request: FastifyRequest) {
  const { org_id, user_id, role, tenant_id } = request.auth;
  const readOnly = !can(request.auth, CAPABILITY.PLATFORM_WRITE);
  return { org_id, user_id, role, tenant_id, readOnly };
}
const wide = (request: FastifyRequest) => service.hasBranchReach(request.auth);

export class SwapsController {
  roster = async (request: FastifyRequest, reply: FastifyReply) => {
    const { from } = request.query as RosterQueryInput;
    return reply.send({ success: true, data: await service.getRoster(ctxOf(request), from, wide(request)) });
  };

  listMine = async (request: FastifyRequest, reply: FastifyReply) =>
    reply.send({ success: true, data: await service.listMine(ctxOf(request)) });

  queue = async (request: FastifyRequest, reply: FastifyReply) =>
    reply.send({ success: true, data: await service.listQueue(ctxOf(request), wide(request)) });

  create = async (request: FastifyRequest, reply: FastifyReply) =>
    reply.status(201).send({ success: true, data: await service.createSwap(ctxOf(request), request.body as CreateShiftSwapInput) });

  respond = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { accept } = request.body as RespondShiftSwapInput;
    return reply.send({ success: true, data: await service.respond(ctxOf(request), id, accept) });
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    return reply.send({ success: true, data: await service.cancel(ctxOf(request), id) });
  };

  approve = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { comment } = request.body as DecideShiftSwapInput;
    return reply.send({ success: true, data: await service.decide(ctxOf(request), id, true, comment ?? null, wide(request)) });
  };

  reject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { comment } = request.body as RejectShiftSwapInput;
    return reply.send({ success: true, data: await service.decide(ctxOf(request), id, false, comment, wide(request)) });
  };
}
