import { z } from 'zod';

// ── Punch (check-in / check-out) ────────────────────────────────────────────
// Photo travels as base64 in the JSON body (the gateway proxies JSON, not
// multipart). 2 MB binary ≈ 2.8M base64 chars — cap generously; the service
// enforces the exact byte limit after decoding. A `data:` URI prefix is accepted
// and stripped server-side.
const PHOTO_MAX_B64_CHARS = 2_900_000;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const punchSchema = z.object({
  geo_lat: latitude.optional(),
  geo_lng: longitude.optional(),
  geo_accuracy_m: z.number().nonnegative().max(100_000).optional(),
  photo: z.string().max(PHOTO_MAX_B64_CHARS).optional(),
  source: z.enum(['web', 'mobile']).default('web'),
  is_wfh: z.boolean().default(false),
});

// check-in and check-out share the same body shape (identical enforcement).
export const checkInSchema = punchSchema;
export const checkOutSchema = punchSchema;

// ── Attendance rules (admin upsert) ─────────────────────────────────────────
export const attendanceRulesAdminSchema = z.object({
  geofence_enabled: z.boolean().default(true),
  geofence_radius_meters: z.number().int().positive().max(100_000).default(200),
  require_photo: z.boolean().default(true),
  require_geo: z.boolean().default(true),
  allow_wfh_checkin: z.boolean().default(false),
  // Dormant face-verification rule fields (accepted, stored, not enforced yet).
  require_face_match: z.boolean().optional(),
  face_match_threshold: z.number().min(50).max(100).optional(),
  face_match_action: z.enum(['flag', 'block']).optional(),
});

// ── Shifts ──────────────────────────────────────────────────────────────────
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM or HH:MM:SS');

export const createShiftSchema = z.object({
  name: z.string().min(1).max(200),
  start_time: timeString,
  end_time: timeString,
  grace_minutes: z.number().int().min(0).max(600).default(10),
  min_half_day_minutes: z.number().int().min(0).max(1440).default(240),
  min_full_day_minutes: z.number().int().min(0).max(1440).default(480),
  is_night_shift: z.boolean().default(false),
});

export const updateShiftSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  start_time: timeString.optional(),
  end_time: timeString.optional(),
  grace_minutes: z.number().int().min(0).max(600).optional(),
  min_half_day_minutes: z.number().int().min(0).max(1440).optional(),
  min_full_day_minutes: z.number().int().min(0).max(1440).optional(),
  is_night_shift: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

// ── Shift assignments ───────────────────────────────────────────────────────
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const createShiftAssignmentSchema = z.object({
  user_id: z.string().uuid(),
  shift_id: z.string().uuid(),
  effective_from: dateString,
  effective_to: dateString.nullable().optional(),
});

export const updateShiftAssignmentSchema = z.object({
  shift_id: z.string().uuid().optional(),
  effective_from: dateString.optional(),
  effective_to: dateString.nullable().optional(),
  is_active: z.boolean().optional(),
});

// ── Regularizations ─────────────────────────────────────────────────────────
export const createRegularizationSchema = z.object({
  work_date: dateString,
  requested_status_name: z
    .enum(['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'wfh'])
    .optional(),
  requested_in: z.string().datetime({ offset: true }).optional(),
  requested_out: z.string().datetime({ offset: true }).optional(),
  reason: z.string().min(1).max(1000),
});

export const approveRegularizationSchema = z.object({
  comment: z.string().max(1000).optional(),
});

export const rejectRegularizationSchema = z.object({
  comment: z.string().min(1).max(1000),
});

export const listRegularizationsSchema = z.object({
  scope: z.enum(['own', 'team']).default('own'),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Face verification (enrollment + review queue) ───────────────────────────
// Reference/probe photos travel as base64 in the JSON body, same as punch photos.
export const faceEnrollSchema = z.object({
  user_id: z.string().uuid(),
  photo: z.string().min(1).max(PHOTO_MAX_B64_CHARS),
  // DPDP consent — MUST be true; the service rejects false with 422.
  consent: z.boolean(),
});

export const faceReviewsQuerySchema = z.object({
  status: z.enum(['pending', 'cleared', 'rejected']).default('pending'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const faceReviewActionSchema = z.object({
  comment: z.string().max(1000).optional(),
});

// ── Read queries ─────────────────────────────────────────────────────────────
const monthString = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM');

export const attendanceMeQuerySchema = z.object({
  month: monthString.optional(),
});

export const attendanceTeamQuerySchema = z.object({
  date: dateString.optional(),
});

export const reportsSummaryQuerySchema = z.object({
  month: monthString.optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});

// ── Inferred types ────────────────────────────────────────────────────────────
export type PunchInput = z.infer<typeof punchSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type CheckOutInput = z.infer<typeof checkOutSchema>;
export type AttendanceRulesAdminInput = z.infer<typeof attendanceRulesAdminSchema>;
export type FaceEnrollInput = z.infer<typeof faceEnrollSchema>;
export type FaceReviewsQueryInput = z.infer<typeof faceReviewsQuerySchema>;
export type FaceReviewActionInput = z.infer<typeof faceReviewActionSchema>;
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type CreateShiftAssignmentInput = z.infer<typeof createShiftAssignmentSchema>;
export type UpdateShiftAssignmentInput = z.infer<typeof updateShiftAssignmentSchema>;
export type CreateRegularizationInput = z.infer<typeof createRegularizationSchema>;
export type ApproveRegularizationInput = z.infer<typeof approveRegularizationSchema>;
export type RejectRegularizationInput = z.infer<typeof rejectRegularizationSchema>;
export type ListRegularizationsInput = z.infer<typeof listRegularizationsSchema>;
export type AttendanceMeQueryInput = z.infer<typeof attendanceMeQuerySchema>;
export type AttendanceTeamQueryInput = z.infer<typeof attendanceTeamQuerySchema>;
export type ReportsSummaryQueryInput = z.infer<typeof reportsSummaryQuerySchema>;
