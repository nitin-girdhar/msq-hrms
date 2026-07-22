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
  createRegularizationSchema,
  approveRegularizationSchema,
  rejectRegularizationSchema,
  listRegularizationsSchema,
  attendanceMeQuerySchema,
  attendanceTeamQuerySchema,
  reportsSummaryQuerySchema,
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
  app.get('/attendance/team', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW_TEAM, 'You do not have permission to view team attendance'), validate({ query: attendanceTeamQuerySchema })] }, ctrl.team);
  // Counts-only form of /attendance/team, for the cross-product "my day" tiles.
  app.get('/attendance/today-summary', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW), validate({ query: attendanceTeamQuerySchema })] }, ctrl.todaySummary);

  // ── Photo (authenticated fetch — never a public static dir) ─────────────────
  app.get('/attendance/photos/:id', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PHOTO_VIEW)] }, ctrl.photo);

  // ── Regularizations (registered before nothing else conflicts) ──────────────
  app.post('/attendance/regularizations', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_REQUEST, 'You do not have permission to request a correction'), validate({ body: createRegularizationSchema })] }, ctrl.createRegularization);
  app.get('/attendance/regularizations', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW), validate({ query: listRegularizationsSchema })] }, ctrl.listRegularizations);
  app.post('/attendance/regularizations/:id/approve', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_APPROVE, 'You do not have permission to approve corrections'), validate({ body: approveRegularizationSchema })] }, ctrl.approveRegularization);
  app.post('/attendance/regularizations/:id/reject', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_REGULARIZATION_REJECT, 'You do not have permission to reject corrections'), validate({ body: rejectRegularizationSchema })] }, ctrl.rejectRegularization);

  // ── Face enrollment / status (hr_admin/org_admin for enroll+delete; view gated in service) ──
  app.post('/attendance/face/enroll', { preHandler: [...gate, requireCapability(CAPABILITY.HR_ATTENDANCE_PUNCH), validate({ body: faceEnrollSchema })] }, ctrl.faceEnroll);
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
}
