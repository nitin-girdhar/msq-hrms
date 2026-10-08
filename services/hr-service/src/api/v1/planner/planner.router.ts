import type { FastifyInstance, FastifyRequest } from 'fastify';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import {
  plannerWeekQuerySchema,
  applyShiftsSchema,
  reallocateShiftsSchema,
  setRequirementSchema,
  publishRosterSchema,
  type PlannerWeekQuery,
  type ApplyShiftsInput,
  type ReallocateShiftsInput,
  type SetRequirementInput,
  type PublishRosterInput,
} from '@hr/validation';
import * as repo from './planner.repository.js';

// Roster planner (schema 1.66.0). Every route needs hr.attendance.roster.manage; the actor and
// the org come from the verified session, never from the request.
function ctxOf(request: FastifyRequest): repo.PlannerCtx {
  const { org_id, user_id, role, tenant_id } = request.auth;
  // platform.write like every other controller: a role without it is read-only at the database.
  return { org_id, user_id, role, tenant_id, readOnly: !can(request.auth, CAPABILITY.PLATFORM_WRITE) };
}

const audit = (request: FastifyRequest, action: string, subject: string, extra: Record<string, unknown>) =>
  void logActivity({ action_type: action, performed_by: request.auth.user_id, subject_user_id: subject, org_id: request.auth.org_id, new_value: extra });

export async function plannerRouter(app: FastifyInstance) {
  const manage = requireCapability(CAPABILITY.HR_ATTENDANCE_ROSTER_MANAGE, 'You do not have permission to plan the roster');

  app.get('/attendance/planner/week', { preHandler: [authenticate, manage, validate({ query: plannerWeekQuerySchema })] }, async (request, reply) =>
    reply.send({ success: true, data: await repo.getWeek(ctxOf(request), request.query as PlannerWeekQuery) }));

  app.put('/attendance/planner/cells', { preHandler: [authenticate, manage, validate({ body: applyShiftsSchema })] }, async (request, reply) => {
    const body = request.body as ApplyShiftsInput;
    const result = await repo.applyShifts(ctxOf(request), body);
    for (const id of result.changed) {
      audit(request, 'roster_shift_changed', id, { from: body.from, to: body.to, shift_id: body.shift_id });
    }
    return reply.send({ success: true, data: { applied: result.applied, skipped: result.skipped } });
  });

  app.post('/attendance/planner/reallocate', { preHandler: [authenticate, manage, validate({ body: reallocateShiftsSchema })] }, async (request, reply) => {
    const body = request.body as ReallocateShiftsInput;
    const result = await repo.reallocate(ctxOf(request), body);
    for (const id of result.changed) {
      audit(request, 'roster_shift_reallocated', id, { from: body.from, to: body.to, from_shift_id: body.from_shift_id, to_shift_id: body.to_shift_id });
    }
    return reply.send({ success: true, data: { applied: result.applied, skipped: result.skipped } });
  });

  app.put('/attendance/planner/requirements', { preHandler: [authenticate, manage, validate({ body: setRequirementSchema })] }, async (request, reply) => {
    const body = request.body as SetRequirementInput;
    await repo.setRequirement(ctxOf(request), body.shift_id, body.required_headcount);
    audit(request, 'roster_requirement_set', request.auth.user_id, { shift_id: body.shift_id, required_headcount: body.required_headcount });
    return reply.status(204).send();
  });

  app.post('/attendance/planner/publish', { preHandler: [authenticate, manage, validate({ body: publishRosterSchema })] }, async (request, reply) => {
    const body = request.body as PublishRosterInput;
    const r = await repo.publishWeek(ctxOf(request), body.week_start, body.note ?? null);
    audit(request, 'roster_published', request.auth.user_id, { week_start: body.week_start });
    return reply.send({ success: true, data: r });
  });
}
