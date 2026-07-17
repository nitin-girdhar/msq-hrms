import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { requireModule } from '../../../middleware/require-module.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
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
  app.post('/attendance/check-in', { preHandler: [...gate, validate({ body: checkInSchema })] }, ctrl.checkIn);
  app.post('/attendance/check-out', { preHandler: [...gate, validate({ body: checkOutSchema })] }, ctrl.checkOut);

  // ── Rules ───────────────────────────────────────────────────────────────────
  app.get('/attendance/rules', { preHandler: [...gate] }, ctrl.getRules);
  app.get('/attendance/rules/admin', { preHandler: [...gate] }, ctrl.getRules);
  app.put('/attendance/rules/admin', { preHandler: [...gate, validate({ body: attendanceRulesAdminSchema })] }, ctrl.updateRules);

  // ── Me / Team ─────────────────────────────────────────────────────────────────
  app.get('/attendance/me', { preHandler: [...gate, validate({ query: attendanceMeQuerySchema })] }, ctrl.me);
  app.get('/attendance/team', { preHandler: [...gate, validate({ query: attendanceTeamQuerySchema })] }, ctrl.team);

  // ── Photo (authenticated fetch — never a public static dir) ─────────────────
  app.get('/attendance/photos/:id', { preHandler: [...gate] }, ctrl.photo);

  // ── Regularizations (registered before nothing else conflicts) ──────────────
  app.post('/attendance/regularizations', { preHandler: [...gate, validate({ body: createRegularizationSchema })] }, ctrl.createRegularization);
  app.get('/attendance/regularizations', { preHandler: [...gate, validate({ query: listRegularizationsSchema })] }, ctrl.listRegularizations);
  app.post('/attendance/regularizations/:id/approve', { preHandler: [...gate, validate({ body: approveRegularizationSchema })] }, ctrl.approveRegularization);
  app.post('/attendance/regularizations/:id/reject', { preHandler: [...gate, validate({ body: rejectRegularizationSchema })] }, ctrl.rejectRegularization);

  // ── Face enrollment / status (hr_admin/org_admin for enroll+delete; view gated in service) ──
  app.post('/attendance/face/enroll', { preHandler: [...gate, validate({ body: faceEnrollSchema })] }, ctrl.faceEnroll);
  app.delete('/attendance/face/enroll/:userId', { preHandler: [...gate] }, ctrl.faceDelete);
  app.get('/attendance/face/status/:userId', { preHandler: [...gate] }, ctrl.faceStatus);
  app.get('/attendance/face/reference/:userId', { preHandler: [...gate] }, ctrl.faceReference);

  // ── Face reviews (same approval authority as regularizations) ───────────────
  app.get('/attendance/face-reviews', { preHandler: [...gate, validate({ query: faceReviewsQuerySchema })] }, ctrl.faceReviews);
  app.post('/attendance/face-reviews/:eventId/clear', { preHandler: [...gate] }, ctrl.faceReviewClear);
  app.post('/attendance/face-reviews/:eventId/reject', { preHandler: [...gate] }, ctrl.faceReviewReject);

  // ── Reports ───────────────────────────────────────────────────────────────────
  app.get('/attendance/reports/summary', { preHandler: [...gate, validate({ query: reportsSummaryQuerySchema })] }, ctrl.reportsSummary);

  // ── Shifts ──────────────────────────────────────────────────────────────────
  app.get('/shifts', { preHandler: [...gate] }, ctrl.listShifts);
  app.post('/shifts', { preHandler: [...gate, validate({ body: createShiftSchema })] }, ctrl.createShift);
  app.patch('/shifts/:id', { preHandler: [...gate, validate({ body: updateShiftSchema })] }, ctrl.updateShift);

  // ── Shift assignments ─────────────────────────────────────────────────────────
  app.get('/shift-assignments', { preHandler: [...gate] }, ctrl.listShiftAssignments);
  app.post('/shift-assignments', { preHandler: [...gate, validate({ body: createShiftAssignmentSchema })] }, ctrl.createShiftAssignment);
  app.patch('/shift-assignments/:id', { preHandler: [...gate, validate({ body: updateShiftAssignmentSchema })] }, ctrl.updateShiftAssignment);
}
