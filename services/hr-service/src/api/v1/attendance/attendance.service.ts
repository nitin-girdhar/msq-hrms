// ─────────────────────────────────────────────────────────────────────────────
// Attendance service — authorization, orchestration, activity logging.
// No SQL here (all DB access is in attendance.repository). No req/res (controller).
// Mirrors the leave module's service/repository split.
// ─────────────────────────────────────────────────────────────────────────────

import { logActivity } from '@crm/audit-log';
import {
  canManageAttendance,
  canManageShifts,
  canViewTeamAttendance,
  canOverrideAttendanceApproval,
} from '@crm/permissions';
import { ForbiddenError, ValidationError } from '../../../lib/errors.js';
import { publishAttendanceEvent } from '../../../lib/events.js';
import * as repo from './attendance.repository.js';
import type { AttendanceCtx } from './attendance.repository.js';
import type {
  CheckInInput,
  CheckOutInput,
  AttendanceRulesAdminInput,
  CreateShiftInput,
  UpdateShiftInput,
  CreateShiftAssignmentInput,
  UpdateShiftAssignmentInput,
  CreateRegularizationInput,
  ListRegularizationsInput,
  FaceEnrollInput,
  FaceReviewsQueryInput,
} from '@crm/validation';

type PunchMeta = { ip: string | null; userAgent: string | null };

// ── Punches ─────────────────────────────────────────────────────────────────
// Notify the punching user's manager when a flagged face mismatch created a
// pending review (fire-and-forget — never fails the committed punch).
function notifyFaceReview(ctx: AttendanceCtx, result: repo.PunchResult) {
  if (!result.notify_manager_id) return;
  void publishAttendanceEvent({
    type: 'attendance:face_review_pending',
    event_id: result.event_id,
    recipient_id: result.notify_manager_id,
    org_id: ctx.org_id,
    tenant_id: ctx.tenant_id,
    actor_id: ctx.user_id,
  });
}

export async function checkIn(ctx: AttendanceCtx, data: CheckInInput, meta: PunchMeta) {
  const result = await repo.punch(ctx, 'check_in', data, meta);
  notifyFaceReview(ctx, result);
  void logActivity({
    action_type: 'attendance_check_in',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { event_id: result.event_id, work_date: result.work_date, is_wfh: result.is_wfh },
  });
  return result;
}

export async function checkOut(ctx: AttendanceCtx, data: CheckOutInput, meta: PunchMeta) {
  const result = await repo.punch(ctx, 'check_out', data, meta);
  notifyFaceReview(ctx, result);
  void logActivity({
    action_type: 'attendance_check_out',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { event_id: result.event_id, work_date: result.work_date, day_status: result.day_status },
  });
  return result;
}

// ── Rules ───────────────────────────────────────────────────────────────────
export async function getRules(ctx: AttendanceCtx) {
  return repo.getEffectiveRules(ctx);
}

export async function updateRules(ctx: AttendanceCtx, data: AttendanceRulesAdminInput) {
  if (!canManageAttendance(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Only HR admins or org admins can manage attendance rules');
  }
  const result = await repo.upsertRules(ctx, data);
  void logActivity({
    action_type: 'attendance_rules_updated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { geofence_radius_meters: result.geofence_radius_meters, require_photo: result.require_photo },
  });
  return result;
}

// ── Me / Team ─────────────────────────────────────────────────────────────────
export async function getMyMonth(ctx: AttendanceCtx, month: string) {
  return repo.getMyMonth(ctx, month);
}

export async function getTeam(ctx: AttendanceCtx, date: string) {
  if (!canViewTeamAttendance(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Insufficient rank to view the team attendance view');
  }
  const seeAllOrg = canManageAttendance(ctx.role, ctx.rank);
  return repo.getTeam(ctx, date, seeAllOrg);
}

// ── Photo (authenticated fetch) ─────────────────────────────────────────────
export async function getPhotoKey(ctx: AttendanceCtx, eventId: string): Promise<string | null> {
  const evt = await repo.loadEventForPhoto(ctx, eventId);
  if (!evt) return null;
  if (evt.user_id !== ctx.user_id && !canManageAttendance(ctx.role, ctx.rank)) {
    if (!(await repo.canViewUserAttendance(ctx, evt.user_id))) {
      throw new ForbiddenError('Not authorized to view this photo');
    }
  }
  return evt.photo_url;
}

// ── Shifts ──────────────────────────────────────────────────────────────────
export async function listShifts(ctx: AttendanceCtx) {
  return repo.listShifts(ctx);
}

function assertCanManageShifts(ctx: AttendanceCtx) {
  if (!canManageShifts(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Only HR admins or org admins can manage shifts');
  }
}

export async function createShift(ctx: AttendanceCtx, data: CreateShiftInput) {
  assertCanManageShifts(ctx);
  const result = await repo.createShift(ctx, data);
  void logActivity({
    action_type: 'attendance_shift_created',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { shift_id: result.id, name: data.name },
  });
  return result;
}

export async function updateShift(ctx: AttendanceCtx, id: string, data: UpdateShiftInput) {
  assertCanManageShifts(ctx);
  await repo.updateShift(ctx, id, data);
}

// ── Shift assignments ─────────────────────────────────────────────────────────
export async function listShiftAssignments(ctx: AttendanceCtx, userId?: string) {
  // Non-managers may only list their own assignments.
  if (!canViewTeamAttendance(ctx.role, ctx.rank)) {
    return repo.listShiftAssignments(ctx, ctx.user_id);
  }
  return repo.listShiftAssignments(ctx, userId);
}

export async function createShiftAssignment(ctx: AttendanceCtx, data: CreateShiftAssignmentInput) {
  assertCanManageShifts(ctx);
  const result = await repo.createShiftAssignment(ctx, data);
  void logActivity({
    action_type: 'attendance_shift_assigned',
    performed_by: ctx.user_id,
    subject_user_id: data.user_id,
    org_id: ctx.org_id,
    new_value: { assignment_id: result.id, shift_id: data.shift_id, effective_from: data.effective_from },
  });
  return result;
}

export async function updateShiftAssignment(ctx: AttendanceCtx, id: string, data: UpdateShiftAssignmentInput) {
  assertCanManageShifts(ctx);
  await repo.updateShiftAssignment(ctx, id, data);
}

// ── Regularizations ───────────────────────────────────────────────────────────
export async function createRegularization(ctx: AttendanceCtx, data: CreateRegularizationInput) {
  const result = await repo.createRegularization(ctx, data);
  void logActivity({
    action_type: 'attendance_regularization_requested',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { regularization_id: result.id, work_date: data.work_date },
  });
  return result;
}

export async function listRegularizations(ctx: AttendanceCtx, filters: ListRegularizationsInput) {
  if (filters.scope === 'team' && !canViewTeamAttendance(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Insufficient rank to view the team regularization queue');
  }
  const seeAllOrg = canManageAttendance(ctx.role, ctx.rank);
  return repo.listRegularizations(ctx, filters, seeAllOrg);
}

export async function approveRegularization(ctx: AttendanceCtx, id: string, comment: string | null) {
  const isOverride = canOverrideAttendanceApproval(ctx.role, ctx.rank);
  const result = await repo.approveRegularization(ctx, id, comment, isOverride);
  void logActivity({
    action_type: 'attendance_regularization_approved',
    performed_by: ctx.user_id,
    subject_user_id: result.requester_id,
    org_id: ctx.org_id,
    new_value: { regularization_id: id, work_date: result.work_date, day_flipped: result.day_flipped },
  });
  return result;
}

export async function rejectRegularization(ctx: AttendanceCtx, id: string, comment: string) {
  const isOverride = canOverrideAttendanceApproval(ctx.role, ctx.rank);
  const result = await repo.rejectRegularization(ctx, id, comment, isOverride);
  void logActivity({
    action_type: 'attendance_regularization_rejected',
    performed_by: ctx.user_id,
    subject_user_id: result.requester_id,
    org_id: ctx.org_id,
    new_value: { regularization_id: id, work_date: result.work_date },
  });
  return result;
}

// ── Reports ───────────────────────────────────────────────────────────────────
export async function monthlySummary(ctx: AttendanceCtx, month: string) {
  if (!canManageAttendance(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Only HR admins or org admins can access attendance reports');
  }
  return repo.monthlySummary(ctx, month);
}

// ── Face enrollment / status / reviews ────────────────────────────────────────
// NOTE: for now only hr_admin/org_admin may enroll/unenroll anyone in-org.
// Self-enrollment (gated by an org "allow self-enrollment" rule) is deferred.
export async function enrollFace(ctx: AttendanceCtx, data: FaceEnrollInput) {
  if (!canManageAttendance(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Only HR admins or org admins can enroll faces');
  }
  // DPDP consent is mandatory — reject a false/absent consent with 422.
  if (!data.consent) {
    throw new ValidationError('Face-enrollment consent is required', { code: 'FACE_CONSENT_REQUIRED' });
  }
  const buf = repo.decodePhoto(data.photo);
  const result = await repo.enrollFace(ctx, data.user_id, buf);
  void logActivity({
    action_type: 'attendance_face_enrolled',
    performed_by: ctx.user_id,
    subject_user_id: data.user_id,
    org_id: ctx.org_id,
    new_value: { face_subject_id: result.face_subject_id, face_enrolled_at: result.face_enrolled_at },
  });
  return result;
}

async function assertCanViewFace(ctx: AttendanceCtx, userId: string) {
  if (userId === ctx.user_id) return;
  if (canManageAttendance(ctx.role, ctx.rank)) return;
  if (await repo.canViewUserAttendance(ctx, userId)) return;
  throw new ForbiddenError('Not authorized to view this user’s face-enrollment status');
}

export async function getFaceStatus(ctx: AttendanceCtx, userId: string) {
  await assertCanViewFace(ctx, userId);
  return repo.getFaceStatus(ctx, userId);
}

export async function getReferencePhotoKey(ctx: AttendanceCtx, userId: string): Promise<string | null> {
  await assertCanViewFace(ctx, userId);
  const ref = await repo.loadReferencePhotoKey(ctx, userId);
  return ref?.key ?? null;
}

export async function deleteFaceEnrollment(ctx: AttendanceCtx, userId: string) {
  if (!canManageAttendance(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Only HR admins or org admins can remove a face enrollment');
  }
  await repo.deleteFaceEnrollment(ctx, userId);
  void logActivity({
    action_type: 'attendance_face_unenrolled',
    performed_by: ctx.user_id,
    subject_user_id: userId,
    org_id: ctx.org_id,
    new_value: { user_id: userId },
  });
}

export async function listFaceReviews(ctx: AttendanceCtx, filters: FaceReviewsQueryInput) {
  if (!canViewTeamAttendance(ctx.role, ctx.rank)) {
    throw new ForbiddenError('Insufficient rank to view the face-review queue');
  }
  const seeAllOrg = canManageAttendance(ctx.role, ctx.rank);
  return repo.listFaceReviews(ctx, filters, seeAllOrg);
}

export async function clearFaceReview(ctx: AttendanceCtx, eventId: string) {
  const isOverride = canOverrideAttendanceApproval(ctx.role, ctx.rank);
  const result = await repo.clearFaceReview(ctx, eventId, isOverride);
  void logActivity({
    action_type: 'attendance_face_review_cleared',
    performed_by: ctx.user_id,
    subject_user_id: result.user_id,
    org_id: ctx.org_id,
    new_value: { event_id: eventId },
  });
  return result;
}

export async function rejectFaceReview(ctx: AttendanceCtx, eventId: string) {
  const isOverride = canOverrideAttendanceApproval(ctx.role, ctx.rank);
  const result = await repo.rejectFaceReview(ctx, eventId, isOverride);
  void logActivity({
    action_type: 'attendance_face_review_rejected',
    performed_by: ctx.user_id,
    subject_user_id: result.user_id,
    org_id: ctx.org_id,
    new_value: { event_id: eventId, work_date: result.work_date, day_recomputed: result.day_recomputed },
  });
  return result;
}
