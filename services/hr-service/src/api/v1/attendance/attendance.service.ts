// ─────────────────────────────────────────────────────────────────────────────
// Attendance service — authorization, orchestration, activity logging.
// No SQL here (all DB access is in attendance.repository). No req/res (controller).
// Mirrors the leave module's service/repository split.
// ─────────────────────────────────────────────────────────────────────────────

import { logActivity } from '@platform/audit-log';
import {
  canManageAttendance,
  canManageShifts,
  canViewTeamAttendance,
  canOverrideAttendanceApproval,
} from '@hr/authz';
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
  RecomputeAttendanceInput,
  CreateRegularizationInput,
  UpdateRegularizationInput,
  ListRegularizationsInput,
  FaceEnrollInput,
  FaceReviewsQueryInput,
} from '@hr/validation';

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
    // The face result belongs in the trail: a suspected buddy-punch otherwise
    // leaves no audit trace at punch time, only in the later review decision.
    new_value: {
      event_id: result.event_id,
      work_date: result.work_date,
      is_wfh: result.is_wfh,
      face_match_score: result.face_match_score,
      face_match_passed: result.face_match_passed,
      face_review_status: result.face_review_status,
    },
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
    new_value: {
      event_id: result.event_id,
      work_date: result.work_date,
      day_status: result.day_status,
      face_match_score: result.face_match_score,
      face_match_passed: result.face_match_passed,
      face_review_status: result.face_review_status,
    },
  });
  return result;
}

// ── Rules ───────────────────────────────────────────────────────────────────
// Two readers, two different gates. The dashboard needs the org's timezone and
// grace window to render a correct "today", so the plain read stays open to
// anyone in the module. The ADMIN read exposes the whole configuration and is
// what the Admin tab loads, so it requires the same grant as writing it —
// otherwise the tab is hidden but its data is still served on request.
export async function getRules(ctx: AttendanceCtx) {
  return repo.getEffectiveRules(ctx);
}

export async function getAdminRules(ctx: AttendanceCtx) {
  if (!canManageAttendance(ctx)) {
    throw new ForbiddenError('Only HR admins or org admins can view attendance rules');
  }
  return repo.getEffectiveRules(ctx);
}

export async function updateRules(ctx: AttendanceCtx, data: AttendanceRulesAdminInput) {
  if (!canManageAttendance(ctx)) {
    throw new ForbiddenError('Only HR admins or org admins can manage attendance rules');
  }
  const result = await repo.upsertRules(ctx, data);
  void logActivity({
    action_type: 'attendance_rules_updated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    // The day-classification thresholds decide whether a day counts as present,
    // half or absent, so a change to them is as consequential as a payroll edit
    // and belongs in the trail alongside the capture rules.
    new_value: {
      geofence_radius_meters: result.geofence_radius_meters,
      require_photo: result.require_photo,
      min_half_day_minutes: result.min_half_day_minutes,
      min_full_day_minutes: result.min_full_day_minutes,
    },
  });
  return result;
}

// ── Me / Team ─────────────────────────────────────────────────────────────────
export async function getMyMonth(ctx: AttendanceCtx, month: string) {
  return repo.getMyMonth(ctx, month);
}

// Self-scoped, like getMyMonth: it reports only the caller's own punch state,
// so it carries no authority beyond HR_ATTENDANCE_VIEW.
export async function getTodayPunchState(ctx: AttendanceCtx) {
  return repo.getTodayPunchState(ctx);
}

export async function getTeam(ctx: AttendanceCtx, date: string) {
  if (!canViewTeamAttendance(ctx)) {
    throw new ForbiddenError('Insufficient rank to view the team attendance view');
  }
  const seeAllOrg = canManageAttendance(ctx);
  return repo.getTeam(ctx, date, seeAllOrg);
}

// Same authority as the team view: this is that roster reduced to counts, so it
// must not become a way to infer team size for someone barred from getTeam.
export async function getTodaySummary(ctx: AttendanceCtx, date: string) {
  if (!canViewTeamAttendance(ctx)) {
    throw new ForbiddenError('Insufficient rank to view the team attendance view');
  }
  const seeAllOrg = canManageAttendance(ctx);
  return repo.getTodaySummary(ctx, date, seeAllOrg);
}

// ── Day punch list (drives the per-punch photo drill-down) ──────────────────
// Same authority as fetching a single punch photo below: own row always, an
// attendance admin anywhere in the org, otherwise only your reporting subtree.
export async function listDayEvents(ctx: AttendanceCtx, userId: string, date: string) {
  if (userId !== ctx.user_id && !canManageAttendance(ctx)) {
    if (!(await repo.canViewUserAttendance(ctx, userId))) {
      throw new ForbiddenError('Not authorized to view this employee’s punches');
    }
  }
  return repo.listDayEvents(ctx, userId, date);
}

// ── Photo (authenticated fetch) ─────────────────────────────────────────────
export async function getPhotoKey(ctx: AttendanceCtx, eventId: string): Promise<string | null> {
  const evt = await repo.loadEventForPhoto(ctx, eventId);
  if (!evt) return null;
  if (evt.user_id !== ctx.user_id && !canManageAttendance(ctx)) {
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
  if (!canManageShifts(ctx)) {
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
  if (!canViewTeamAttendance(ctx)) {
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

/**
 * Re-resolve already-resolved attendance days — the manual counterpart to the
 * nightly job, for when a shift assignment changed after the fact.
 *
 * Same authority as shift management: whoever can change the shift that drives a
 * day's classification is who may re-apply it. Audited, because it rewrites
 * historical attendance rows.
 */
export async function recomputeAttendance(ctx: AttendanceCtx, data: RecomputeAttendanceInput) {
  assertCanManageShifts(ctx);
  const result = await repo.recomputeAttendance(ctx, data);
  void logActivity({
    action_type: 'attendance_recomputed',
    performed_by: ctx.user_id,
    subject_user_id: data.user_id ?? ctx.user_id,
    org_id: ctx.org_id,
    new_value: {
      scope: data.user_id ? 'single_employee' : 'org',
      from: data.from,
      to: data.to,
      ...result,
    },
  });
  return result;
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

// Requester-side edits. No approver authority is involved — the repository's
// self-RLS + pending guard is the whole rule, so there is no rank check here.
export async function updateRegularization(ctx: AttendanceCtx, id: string, data: UpdateRegularizationInput) {
  await repo.updateRegularization(ctx, id, data);
  void logActivity({
    action_type: 'attendance_regularization_updated',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { regularization_id: id, ...data },
  });
}

export async function cancelRegularization(ctx: AttendanceCtx, id: string) {
  await repo.cancelRegularization(ctx, id);
  void logActivity({
    action_type: 'attendance_regularization_cancelled',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { regularization_id: id },
  });
}

export async function listRegularizations(ctx: AttendanceCtx, filters: ListRegularizationsInput) {
  if (filters.scope === 'team' && !canViewTeamAttendance(ctx)) {
    throw new ForbiddenError('Insufficient rank to view the team regularization queue');
  }
  const seeAllOrg = canManageAttendance(ctx);
  return repo.listRegularizations(ctx, filters, seeAllOrg);
}

export async function approveRegularization(ctx: AttendanceCtx, id: string, comment: string | null) {
  const isOverride = canOverrideAttendanceApproval(ctx);
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
  const isOverride = canOverrideAttendanceApproval(ctx);
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
  if (!canManageAttendance(ctx)) {
    throw new ForbiddenError('Only HR admins or org admins can access attendance reports');
  }
  return repo.monthlySummary(ctx, month);
}

// ── Face enrollment / status / reviews ────────────────────────────────────────
// A member may enroll THEMSELVES; hr_admin/org_admin may enroll anyone in-org.
// The reference photo is the user's avatar (uploaded first via identity-service);
// enroll reads it, so no image travels in this request. Self-enrolment is rate-
// limited by the org's photo-change cooldown; admins bypass it.
export async function enrollFace(ctx: AttendanceCtx, data: FaceEnrollInput) {
  const isSelf = data.user_id === ctx.user_id;
  const isAdmin = canManageAttendance(ctx);
  if (!isSelf && !isAdmin) {
    throw new ForbiddenError('You can only enroll your own face');
  }
  // DPDP consent is mandatory — reject a false/absent consent with 422.
  if (!data.consent) {
    throw new ValidationError('Face-enrollment consent is required', { code: 'FACE_CONSENT_REQUIRED' });
  }
  // Cooldown applies to self-service only; admins change a reference any time.
  if (isSelf && !isAdmin) {
    const remaining = await repo.enrollCooldownRemainingDays(ctx, data.user_id);
    if (remaining > 0) {
      throw new ValidationError(
        `You can change your reference photo again in ${remaining} day${remaining === 1 ? '' : 's'}`,
        { code: 'FACE_CHANGE_COOLDOWN', remaining_days: remaining },
      );
    }
  }
  const result = await repo.enrollFace(ctx, data.user_id);
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
  if (canManageAttendance(ctx)) return;
  if (await repo.canViewUserAttendance(ctx, userId)) return;
  throw new ForbiddenError('Not authorized to view this user’s face-enrollment status');
}

export async function getFaceStatus(ctx: AttendanceCtx, userId: string) {
  await assertCanViewFace(ctx, userId);
  return repo.getFaceStatus(ctx, userId);
}

// Self-service enrollment context for the shared photo-upload modal: drives
// whether the "change photo" action is offered and, if within cooldown, when it
// unlocks. Always about the caller — no extra authorization needed.
export async function getSelfFaceContext(ctx: AttendanceCtx) {
  return repo.getSelfFaceContext(ctx);
}

export async function getReferencePhotoKey(ctx: AttendanceCtx, userId: string): Promise<string | null> {
  await assertCanViewFace(ctx, userId);
  const ref = await repo.loadReferencePhotoKey(ctx, userId);
  return ref?.key ?? null;
}

export async function deleteFaceEnrollment(ctx: AttendanceCtx, userId: string) {
  if (!canManageAttendance(ctx)) {
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
  if (!canViewTeamAttendance(ctx)) {
    throw new ForbiddenError('Insufficient rank to view the face-review queue');
  }
  const seeAllOrg = canManageAttendance(ctx);
  return repo.listFaceReviews(ctx, filters, seeAllOrg);
}

export async function clearFaceReview(ctx: AttendanceCtx, eventId: string) {
  const isOverride = canOverrideAttendanceApproval(ctx);
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
  const isOverride = canOverrideAttendanceApproval(ctx);
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
