import type { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './internal.service.js';
import type { SyncEmployeeProfileInput } from './internal.schema.js';

export class InternalController {
  syncEmployeeProfile = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as SyncEmployeeProfileInput;
    const result = await service.syncEmployeeProfile(body);
    return reply.send({ success: true, data: result });
  };
}
