import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { requireModule } from '../../../middleware/require-module.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { CAPABILITY } from '@platform/rbac';
import { AttendanceController } from './attendance.controller.js';
import {
  checkInSchema,
  checkOutSchema,
  attendanceRulesAdminSchema,
  createShiftSchema,
  updateShiftSchema,
  createShiftAssignmentSchema,
  updateShiftAssignmentSchema,
  recomputeAttendanceSchema,
  createRegularizationSchema,
  updateRegularizationSchema,
  approveRegularizationSchema,
  rejectRegularizationSchema,
  listRegularizationsSchema,
  attendanceMeQuerySchema,
  attendanceTeamQuerySchema,
  reportsSummaryQuerySchema,
  dayEventsQuerySchema,
  faceEnrollSchema,
  faceReviewsQuerySchema,
} from './attendance.schema.js';

const ctrl = new AttendanceController();

// Every route behind requireModule('attendance'). Gateway maps
// /hr/attendance/* → /api/v1/attendance/* and /hr/shifts* → /api/v1/shifts*.
export async function attendanceRouter(app: FastifyInstance) {
  const gate = [authenticate, requireModule('attendance')] as const;

  // ── Punches (identical geofence + photo enforcement) ────────────────────────
  app.post('/attendance/check-in', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PUNCH, 'You do not have permission to record attendance'), validate({ body: checkInSchema })] }, ctrl.checkIn);
  app.post('/attendance/check-out', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PUNCH, 'You do not have permission to record attendance'), validate({ body: checkOutSchema })] }, ctrl.checkOut);

  // ── Rules ───────────────────────────────────────────────────────────────────
  app.get('/attendance/rules', { preHandler: [...gate] }, ctrl.getRules);
  app.get('/attendance/rules/admin', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_RULES_VIEW, 'You do not have permission to view attendance rules')] }, ctrl.getAdminRules);
  app.put('/attendance/rules/admin', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_RULES_UPDATE, 'You do not have permission to change attendance rules'), validate({ body: attendanceRulesAdminSchema })] }, ctrl.updateRules);

  // ── Me / Team ─────────────────────────────────────────────────────────────────
  app.get('/attendance/me', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW), validate({ query: attendanceMeQuerySchema })] }, ctrl.me);
  // Self-scoped: what the caller's next punch may be today. Same capability as
  // /attendance/me because it exposes nothing beyond the caller's own day.
  app.get('/attendance/today-state', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW)] }, ctrl.todayState);
  app.get('/attendance/team', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW_TEAM, 'You do not have permission to view team attendance'), validate({ query: attendanceTeamQuerySchema })] }, ctrl.team);
  // Counts-only form of /attendance/team, for the cross-product "my day" tiles.
  app.get('/attendance/today-summary', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW), validate({ query: attendanceTeamQuerySchema })] }, ctrl.todaySummary);

  // ── Photo (authenticated fetch — never a public static dir) ─────────────────
  // Every punch of one employee's day, so a reviewer can open ANY punch's selfie.
  // The team view only carries the first check-in and last check-out, which hides
  // a split shift's middle punches. Same capability as the photos it leads to.
  app.get('/attendance/events', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PHOTO_VIEW), validate({ query: dayEventsQuerySchema })] }, ctrl.dayEvents);
  app.get('/attendance/photos/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PHOTO_VIEW)] }, ctrl.photo);

  // ── Regularizations (registered before nothing else conflicts) ──────────────
  app.post('/attendance/regularizations', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_REQUEST, 'You do not have permission to request a correction'), validate({ body: createRegularizationSchema })] }, ctrl.createRegularization);
  app.get('/attendance/regularizations', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW), validate({ query: listRegularizationsSchema })] }, ctrl.listRegularizations);
  // Requester-side edit / withdraw: same capability as filing one, because the
  // authority being exercised is "this is my request", not an approval.
  app.patch('/attendance/regularizations/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_REQUEST, 'You do not have permission to change this request'), validate({ body: updateRegularizationSchema })] }, ctrl.updateRegularization);
  app.post('/attendance/regularizations/:id/cancel', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_REQUEST, 'You do not have permission to change this request')] }, ctrl.cancelRegularization);
  app.post('/attendance/regularizations/:id/approve', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_APPROVE, 'You do not have permission to approve corrections'), validate({ body: approveRegularizationSchema })] }, ctrl.approveRegularization);
  app.post('/attendance/regularizations/:id/reject', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_REJECT, 'You do not have permission to reject corrections'), validate({ body: rejectRegularizationSchema })] }, ctrl.rejectRegularization);

  // ── Face enrollment / status (self-enroll allowed; view gated in service) ──
  // Enroll needs only PUNCH — every employee holds it — because a member may
  // enroll themselves; the service gates enrolling *others* to admins.
  app.post('/attendance/face/enroll', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PUNCH), validate({ body: faceEnrollSchema })] }, ctrl.faceEnroll);
  app.get('/attendance/face/me', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PUNCH)] }, ctrl.faceSelf);
  app.delete('/attendance/face/enroll/:userId', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_RULES_UPDATE, 'You do not have permission to reset face enrolment')] }, ctrl.faceDelete);
  app.get('/attendance/face/status/:userId', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PHOTO_VIEW)] }, ctrl.faceStatus);
  app.get('/attendance/face/reference/:userId', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PHOTO_VIEW)] }, ctrl.faceReference);

  // ── Face reviews (same approval authority as regularizations) ───────────────
  app.get('/attendance/face-reviews', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_APPROVE), validate({ query: faceReviewsQuerySchema })] }, ctrl.faceReviews);
  app.post('/attendance/face-reviews/:eventId/clear', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_APPROVE)] }, ctrl.faceReviewClear);
  app.post('/attendance/face-reviews/:eventId/reject', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_REJECT)] }, ctrl.faceReviewReject);

  // ── Reports ───────────────────────────────────────────────────────────────────
  app.get('/attendance/reports/summary', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_REPORTS_VIEW, 'You do not have permission to view attendance reports'), validate({ query: reportsSummaryQuerySchema })] }, ctrl.reportsSummary);

  // ── Shifts ──────────────────────────────────────────────────────────────────
  app.get('/shifts', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_SHIFTS_VIEW)] }, ctrl.listShifts);
  app.post('/shifts', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_SHIFTS_MANAGE, 'You do not have permission to manage shifts'), validate({ body: createShiftSchema })] }, ctrl.createShift);
  app.patch('/shifts/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_SHIFTS_MANAGE, 'You do not have permission to manage shifts'), validate({ body: updateShiftSchema })] }, ctrl.updateShift);

  // ── Shift assignments ─────────────────────────────────────────────────────────
  app.get('/shift-assignments', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_ASSIGNMENTS_VIEW)] }, ctrl.listShiftAssignments);
  app.post('/shift-assignments', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_ASSIGNMENTS_MANAGE, 'You do not have permission to assign shifts'), validate({ body: createShiftAssignmentSchema })] }, ctrl.createShiftAssignment);
  app.patch('/shift-assignments/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_ASSIGNMENTS_MANAGE, 'You do not have permission to assign shifts'), validate({ body: updateShiftAssignmentSchema })] }, ctrl.updateShiftAssignment);

  // Re-resolve already-resolved days after a shift assignment changed. The
  // nightly job cannot do this (it only fills days with no row yet), so this is
  // the only way to reclassify a day the employee has already punched.
  app.post('/attendance/recompute', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_ADMIN_ASSIGNMENTS_MANAGE, 'You do not have permission to recompute attendance'), validate({ body: recomputeAttendanceSchema })] }, ctrl.recomputeAttendance);
}
