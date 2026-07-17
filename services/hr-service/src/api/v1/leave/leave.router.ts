import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { requireModule } from '../../../middleware/require-module.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { LeaveController } from './leave.controller.js';
import {
  applyLeaveRequestSchema,
  previewLeaveRequestSchema,
  listLeaveRequestsSchema,
  approveLeaveRequestSchema,
  rejectLeaveRequestSchema,
  cancelLeaveRequestSchema,
  listLedgerSchema,
  createAdjustmentSchema,
  listPoliciesSchema,
  createPolicySchema,
  updatePolicySchema,
  listHolidaysSchema,
  createHolidaySchema,
  updateHolidaySchema,
  createHolidayCalendarSchema,
  updateHolidayCalendarSchema,
  updateLeaveSettingsSchema,
} from './leave.schema.js';

const ctrl = new LeaveController();

// Every route behind requireModule('leave'). Gateway maps /hr/leave/* →
// /api/v1/leave/* and /hr/holidays* → /api/v1/holidays* (Prompt 2 proxying).
export async function leaveRouter(app: FastifyInstance) {
  const gate = [authenticate, requireModule('leave')] as const;

  // Liveness probe proving the module gate works end-to-end.
  app.get('/leave/ping', { preHandler: [...gate] }, async (_req, reply) =>
    reply.send({ success: true, data: { pong: true } }),
  );

  // ── Requests ──────────────────────────────────────────────────────────────
  app.post('/leave/requests', { preHandler: [...gate, validate({ body: applyLeaveRequestSchema })] }, ctrl.apply);
  // Read-only working-days preview (commits nothing) — must be registered before
  // the ':id' routes so 'preview' is not captured as an id.
  app.get('/leave/requests/preview', { preHandler: [...gate, validate({ query: previewLeaveRequestSchema })] }, ctrl.preview);
  app.get('/leave/requests', { preHandler: [...gate, validate({ query: listLeaveRequestsSchema })] }, ctrl.listMine);
  app.get('/leave/requests/team', { preHandler: [...gate, validate({ query: listLeaveRequestsSchema })] }, ctrl.listTeam);
  app.post('/leave/requests/:id/approve', { preHandler: [...gate, validate({ body: approveLeaveRequestSchema })] }, ctrl.approve);
  app.post('/leave/requests/:id/reject', { preHandler: [...gate, validate({ body: rejectLeaveRequestSchema })] }, ctrl.reject);
  app.post('/leave/requests/:id/cancel', { preHandler: [...gate, validate({ body: cancelLeaveRequestSchema })] }, ctrl.cancel);

  // ── Balances & ledger ─────────────────────────────────────────────────────
  app.get('/leave/balances', { preHandler: [...gate] }, ctrl.balances);
  app.get('/leave/balances/:userId', { preHandler: [...gate] }, ctrl.balancesForUser);
  app.get('/leave/ledger', { preHandler: [...gate, validate({ query: listLedgerSchema })] }, ctrl.ledger);
  app.post('/leave/adjustments', { preHandler: [...gate, validate({ body: createAdjustmentSchema })] }, ctrl.adjustment);

  // ── Policies ────────────────────────────────────────────────────────────────
  app.get('/leave/policies', { preHandler: [...gate, validate({ query: listPoliciesSchema })] }, ctrl.listPolicies);
  app.post('/leave/policies', { preHandler: [...gate, validate({ body: createPolicySchema })] }, ctrl.createPolicy);
  app.patch('/leave/policies/:id', { preHandler: [...gate, validate({ body: updatePolicySchema })] }, ctrl.updatePolicy);

  // ── Settings ──────────────────────────────────────────────────────────────────
  app.get('/leave/settings', { preHandler: [...gate] }, ctrl.getSettings);
  app.put('/leave/settings', { preHandler: [...gate, validate({ body: updateLeaveSettingsSchema })] }, ctrl.updateSettings);

  // ── Holidays & calendars ─────────────────────────────────────────────────────
  app.get('/holidays', { preHandler: [...gate, validate({ query: listHolidaysSchema })] }, ctrl.listHolidays);
  app.post('/holidays', { preHandler: [...gate, validate({ body: createHolidaySchema })] }, ctrl.createHoliday);
  app.patch('/holidays/:id', { preHandler: [...gate, validate({ body: updateHolidaySchema })] }, ctrl.updateHoliday);
  app.get('/holiday-calendars', { preHandler: [...gate] }, ctrl.listCalendars);
  app.post('/holiday-calendars', { preHandler: [...gate, validate({ body: createHolidayCalendarSchema })] }, ctrl.createCalendar);
  app.patch('/holiday-calendars/:id', { preHandler: [...gate, validate({ body: updateHolidayCalendarSchema })] }, ctrl.updateCalendar);
}
