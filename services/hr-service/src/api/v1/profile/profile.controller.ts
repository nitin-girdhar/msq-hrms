import type { FastifyRequest, FastifyReply } from 'fastify';
import { can, CAPABILITY } from '@platform/rbac';
import * as service from './profile.service.js';
import type {
  UpsertPersonalInput,
  CreateEmergencyContactInput,
  UpdateEmergencyContactInput,
  CreateEmployeeNoteInput,
} from './profile.schema.js';

function ctxOf(request: FastifyRequest) {
  const { org_id, user_id, role, tenant_id } = request.auth;
  // A role without platform.write runs its transaction read-only, so a missed
  // app-layer check still cannot write (same defence-in-depth as the leave module).
  const readOnly = !can(request.auth, CAPABILITY.PLATFORM_WRITE);
  return { org_id, user_id, role, tenant_id, readOnly };
}

export class ProfileController {
  // ── My profile: always the caller's own data; the id is never taken from the request ──
  getMine = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getOwnProfile(ctxOf(request));
    return reply.send({ success: true, data });
  };

  savePersonal = async (request: FastifyRequest, reply: FastifyReply) => {
    await service.savePersonal(ctxOf(request), request.body as UpsertPersonalInput);
    return reply.status(204).send();
  };

  addContact = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.addContact(ctxOf(request), request.body as CreateEmergencyContactInput);
    return reply.status(201).send({ success: true, data: result });
  };

  updateContact = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateContact(ctxOf(request), id, request.body as UpdateEmergencyContactInput);
    return reply.status(204).send();
  };

  removeContact = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.removeContact(ctxOf(request), id);
    return reply.status(204).send();
  };

  // ── Employee 360 ───────────────────────────────────────────────────────────
  get360 = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    // The route proved hr.employees.profile360.view; reading HR notes is its own permission.
    const canSeeNotes = can(request.auth, CAPABILITY.HR_EMPLOYEES_NOTES_MANAGE);
    const data = await service.getEmployee360(ctxOf(request), userId, canSeeNotes);
    return reply.send({ success: true, data });
  };

  addNote = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const result = await service.addNote(ctxOf(request), userId, request.body as CreateEmployeeNoteInput);
    return reply.status(201).send({ success: true, data: result });
  };
}
