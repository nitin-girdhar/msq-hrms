import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { requireModule } from '../../../middleware/require-module.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { CAPABILITY } from '@platform/rbac';
import { LeaveController } from './leave.controller.js';
import {
  applyLeaveRequestSchema,
  updateLeaveRequestSchema,
  previewLeaveRequestSchema,
  listLeaveRequestsSchema,
  approveLeaveRequestSchema,
  rejectLeaveRequestSchema,
  cancelLeaveRequestSchema,
  bulkLeaveDecisionSchema,
  requestLeaveInfoSchema,
  createEncashmentSchema,
  createCompOffClaimSchema,
  listCompOffQueueSchema,
  decideCompOffSchema,
  rejectCompOffSchema,
  listBalancesSchema,
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
  app.post('/leave/requests', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_REQUEST_CREATE, 'You do not have permission to apply for leave'), validate({ body: applyLeaveRequestSchema })] }, ctrl.apply);
  // Read-only working-days preview (commits nothing) — must be registered before
  // the ':id' routes so 'preview' is not captured as an id.
  app.get('/leave/requests/preview', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_REQUEST_CREATE), validate({ query: previewLeaveRequestSchema })] }, ctrl.preview);
  app.get('/leave/requests', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW), validate({ query: listLeaveRequestsSchema })] }, ctrl.listMine);
  app.get('/leave/requests/team', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW), validate({ query: listLeaveRequestsSchema })] }, ctrl.listTeam);
  // Own-request detail: full approval chain (all levels, approver names, comments)
  // plus who it's currently pending with. Ownership is enforced in the repository
  // query, so this shares HR_LEAVE_VIEW rather than an approver capability.
  app.get('/leave/requests/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW)] }, ctrl.getMine);
  // Amending your own still-pending request. Gated on the same capability as
  // applying: whoever may raise a request may correct it before it is decided.
  app.patch('/leave/requests/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_REQUEST_CREATE, 'You do not have permission to edit leave requests'), validate({ body: updateLeaveRequestSchema })] }, ctrl.update);
  // Many decisions in one call. Registered before the ':id' routes; the capability
  // (approve vs reject) is checked in the controller because it depends on the body.
  app.post('/leave/requests/bulk-decision', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW), validate({ body: bulkLeaveDecisionSchema })] }, ctrl.bulkDecide);
  app.post('/leave/requests/:id/request-info', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_APPROVE, 'You do not have permission to ask for more information'), validate({ body: requestLeaveInfoSchema })] }, ctrl.requestInfo);
  app.post('/leave/requests/:id/approve', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_APPROVE, 'You do not have permission to approve leave'), validate({ body: approveLeaveRequestSchema })] }, ctrl.approve);
  app.post('/leave/requests/:id/reject', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_REJECT, 'You do not have permission to reject leave'), validate({ body: rejectLeaveRequestSchema })] }, ctrl.reject);
  app.post('/leave/requests/:id/cancel', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_REQUEST_CANCEL, 'You do not have permission to cancel leave'), validate({ body: cancelLeaveRequestSchema })] }, ctrl.cancel);

  // ── Policy summary + encashment (1.64.0) ──────────────────────────────────
  // The employee-safe projection of the policies (admin-only GET /leave/policies keeps accrual etc.).
  app.get('/leave/policy-summary', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW)] }, ctrl.policySummary);
  app.post('/leave/encashments', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ENCASHMENT_REQUEST, 'You do not have permission to request encashment'), validate({ body: createEncashmentSchema })] }, ctrl.createEncashment);
  app.get('/leave/encashments', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW)] }, ctrl.listOwnEncashments);
  app.get('/leave/encashments/queue', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ENCASHMENT_APPROVE), validate({ query: listCompOffQueueSchema })] }, ctrl.encashmentQueue);
  app.post('/leave/encashments/:id/approve', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ENCASHMENT_APPROVE, 'You do not have permission to decide encashment'), validate({ body: decideCompOffSchema })] }, ctrl.approveEncashment);
  app.post('/leave/encashments/:id/reject', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ENCASHMENT_APPROVE, 'You do not have permission to decide encashment'), validate({ body: rejectCompOffSchema })] }, ctrl.rejectEncashment);
  app.post('/leave/encashments/:id/cancel', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ENCASHMENT_REQUEST, 'You do not have permission to cancel encashment')] }, ctrl.cancelEncashment);

  // ── Comp-off ──────────────────────────────────────────────────────────────
  // Claiming and cancelling need the request capability; the approvals queue and
  // decisions need the approve capability. Per-claim authority (assigned approver
  // or override, never your own claim) is re-checked in the repository.
  app.post('/leave/comp-off', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_COMP_OFF_REQUEST, 'You do not have permission to claim comp-off'), validate({ body: createCompOffClaimSchema })] }, ctrl.createCompOff);
  app.get('/leave/comp-off', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW)] }, ctrl.listOwnCompOff);
  app.get('/leave/comp-off/queue', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_COMP_OFF_APPROVE), validate({ query: listCompOffQueueSchema })] }, ctrl.listCompOffQueue);
  app.post('/leave/comp-off/:id/approve', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_COMP_OFF_APPROVE, 'You do not have permission to decide comp-off claims'), validate({ body: decideCompOffSchema })] }, ctrl.approveCompOff);
  app.post('/leave/comp-off/:id/reject', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_COMP_OFF_APPROVE, 'You do not have permission to decide comp-off claims'), validate({ body: rejectCompOffSchema })] }, ctrl.rejectCompOff);
  app.post('/leave/comp-off/:id/cancel', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_COMP_OFF_REQUEST, 'You do not have permission to cancel comp-off claims')] }, ctrl.cancelCompOff);

  // ── Balances & ledger ─────────────────────────────────────────────────────
  // Balance per leave type as on ?as_of= (default today). This is the ENTIRE
  // employee-facing leave payload — the number, not the policy that produced it.
  app.get('/leave/balances', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW), validate({ query: listBalancesSchema })] }, ctrl.balances);
  app.get('/leave/balances/:userId', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW), validate({ query: listBalancesSchema })] }, ctrl.balancesForUser);
  app.get('/leave/ledger', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW), validate({ query: listLedgerSchema })] }, ctrl.ledger);
  app.post('/leave/adjustments', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_ADJUSTMENT_CREATE, 'You do not have permission to adjust leave balances'), validate({ body: createAdjustmentSchema })] }, ctrl.adjustment);

  // ── Policies ────────────────────────────────────────────────────────────────
  // Admin-only, and it must stay that way: every row carries accrual frequency and
  // amount, max balance, carry-forward caps, notice rules and approval depth, for
  // every past, future and inactive revision. An employee needs none of it — the
  // dashboard reads /leave/balances?as_of=, and the per-request limits reach the
  // apply form just-in-time through /leave/requests/preview.
  app.get('/leave/policies', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_POLICIES_VIEW), validate({ query: listPoliciesSchema })] }, ctrl.listPolicies);
  app.post('/leave/policies', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_POLICIES_MANAGE, 'You do not have permission to manage leave policies'), validate({ body: createPolicySchema })] }, ctrl.createPolicy);
  app.patch('/leave/policies/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_POLICIES_MANAGE, 'You do not have permission to manage leave policies'), validate({ body: updatePolicySchema })] }, ctrl.updatePolicy);

  // ── Settings ──────────────────────────────────────────────────────────────────
  app.get('/leave/settings', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_CYCLE_MANAGE)] }, ctrl.getSettings);
  app.put('/leave/settings', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_CYCLE_MANAGE, 'You do not have permission to change the leave year'), validate({ body: updateLeaveSettingsSchema })] }, ctrl.updateSettings);

  // ── Holidays & calendars ─────────────────────────────────────────────────────
  // Read-only reference data: anyone who can see leave needs the holiday
  // calendar (e.g. TeamLeaveCalendar), not just holidays admins — matches
  // /leave/balances, /leave/ledger, etc. Creating/editing stays admin-only.
  app.get('/holidays', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW), validate({ query: listHolidaysSchema })] }, ctrl.listHolidays);
  app.post('/holidays', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_HOLIDAYS_MANAGE, 'You do not have permission to manage holidays'), validate({ body: createHolidaySchema })] }, ctrl.createHoliday);
  app.patch('/holidays/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_HOLIDAYS_MANAGE, 'You do not have permission to manage holidays'), validate({ body: updateHolidaySchema })] }, ctrl.updateHoliday);
  app.get('/holiday-calendars', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_VIEW)] }, ctrl.listCalendars);
  app.post('/holiday-calendars', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_HOLIDAYS_MANAGE, 'You do not have permission to manage holidays'), validate({ body: createHolidayCalendarSchema })] }, ctrl.createCalendar);
  app.patch('/holiday-calendars/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_LEAVE_ADMIN_HOLIDAYS_MANAGE, 'You do not have permission to manage holidays'), validate({ body: updateHolidayCalendarSchema })] }, ctrl.updateCalendar);
}
