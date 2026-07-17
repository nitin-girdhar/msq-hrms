import type { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './leave.service.js';
import type { LeaveCtx } from './leave.repository.js';
import type {
  ApplyLeaveRequestInput,
  PreviewLeaveRequestInput,
  ListLeaveRequestsInput,
  ApproveLeaveRequestInput,
  RejectLeaveRequestInput,
  CancelLeaveRequestInput,
  ListLedgerInput,
  CreateAdjustmentInput,
  ListPoliciesInput,
  CreatePolicyInput,
  UpdatePolicyInput,
  ListHolidaysInput,
  CreateHolidayInput,
  UpdateHolidayInput,
  CreateHolidayCalendarInput,
  UpdateHolidayCalendarInput,
  UpdateLeaveSettingsInput,
} from './leave.schema.js';

function ctxOf(request: FastifyRequest): LeaveCtx {
  const { org_id, user_id, role, tenant_id, rank } = request.auth;
  return { org_id, user_id, role, tenant_id, rank };
}

export class LeaveController {
  // ── Requests ──────────────────────────────────────────────────────────────
  apply = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.applyLeave(ctxOf(request), request.body as ApplyLeaveRequestInput);
    return reply.status(201).send({ success: true, data: result });
  };

  preview = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.previewLeave(ctxOf(request), request.query as PreviewLeaveRequestInput);
    return reply.send({ success: true, data });
  };

  listMine = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.listOwnRequests(ctxOf(request), request.query as ListLeaveRequestsInput);
    return reply.send({ success: true, ...result });
  };

  listTeam = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.listTeamRequests(ctxOf(request), request.query as ListLeaveRequestsInput);
    return reply.send({ success: true, ...result });
  };

  approve = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { comment } = request.body as ApproveLeaveRequestInput;
    const result = await service.approveLeave(ctxOf(request), id, comment ?? null);
    return reply.send({ success: true, data: result });
  };

  reject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { comment } = request.body as RejectLeaveRequestInput;
    const result = await service.rejectLeave(ctxOf(request), id, comment);
    return reply.send({ success: true, data: result });
  };

  cancel = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { comment } = request.body as CancelLeaveRequestInput;
    const result = await service.cancelLeave(ctxOf(request), id, comment ?? null);
    return reply.send({ success: true, data: result });
  };

  // ── Balances & ledger ─────────────────────────────────────────────────────
  balances = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.listOwnBalances(ctxOf(request));
    return reply.send({ success: true, data });
  };

  balancesForUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const data = await service.getUserBalances(ctxOf(request), userId);
    return reply.send({ success: true, data });
  };

  ledger = async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = ctxOf(request);
    const { userId, page, limit } = request.query as ListLedgerInput;
    const result = await service.listLedger(ctx, userId ?? ctx.user_id, page, limit);
    return reply.send({ success: true, ...result });
  };

  adjustment = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createAdjustment(ctxOf(request), request.body as CreateAdjustmentInput);
    return reply.status(201).send({ success: true, data: result });
  };

  // ── Policies ────────────────────────────────────────────────────────────────
  listPolicies = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.listPolicies(ctxOf(request), request.query as ListPoliciesInput);
    return reply.send({ success: true, data });
  };

  createPolicy = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createPolicy(ctxOf(request), request.body as CreatePolicyInput);
    return reply.status(201).send({ success: true, data: result });
  };

  updatePolicy = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updatePolicy(ctxOf(request), id, request.body as UpdatePolicyInput);
    return reply.status(204).send();
  };

  // ── Holidays & calendars ─────────────────────────────────────────────────────
  listHolidays = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.listHolidays(ctxOf(request), request.query as ListHolidaysInput);
    return reply.send({ success: true, data });
  };

  createHoliday = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createHoliday(ctxOf(request), request.body as CreateHolidayInput);
    return reply.status(201).send({ success: true, data: result });
  };

  updateHoliday = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateHoliday(ctxOf(request), id, request.body as UpdateHolidayInput);
    return reply.status(204).send();
  };

  listCalendars = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.listHolidayCalendars(ctxOf(request));
    return reply.send({ success: true, data });
  };

  createCalendar = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createHolidayCalendar(ctxOf(request), request.body as CreateHolidayCalendarInput);
    return reply.status(201).send({ success: true, data: result });
  };

  updateCalendar = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateHolidayCalendar(ctxOf(request), id, request.body as UpdateHolidayCalendarInput);
    return reply.status(204).send();
  };

  // ── Settings ──────────────────────────────────────────────────────────────────
  getSettings = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getSettings(ctxOf(request));
    return reply.send({ success: true, data });
  };

  updateSettings = async (request: FastifyRequest, reply: FastifyReply) => {
    const { leave_cycle_start_month, scope } = request.body as UpdateLeaveSettingsInput;
    await service.updateSettings(ctxOf(request), leave_cycle_start_month, scope);
    return reply.status(204).send();
  };
}
