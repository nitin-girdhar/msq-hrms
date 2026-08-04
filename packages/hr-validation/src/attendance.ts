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

// A half-day floor above the full-day floor makes 'half_day' unreachable — every
// day would resolve to either 'present' or 'absent'. Shared by the rules and
// shift schemas, and mirrored by a DB CHECK on hr.attendance_rules.
function checkThresholdOrder(
  v: { min_half_day_minutes?: number | undefined; min_full_day_minutes?: number | undefined },
  ctx: z.RefinementCtx,
): void {
  const half = v.min_half_day_minutes;
  const full = v.min_full_day_minutes;
  if (half === undefined || full === undefined) return;
  if (half > full) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['min_half_day_minutes'],
      message: 'The half-day minimum must not exceed the full-day minimum.',
    });
  }
}

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
  // Min days before a member may self-change their reference photo (admins bypass).
  photo_change_cooldown_days: z.number().int().min(0).max(365).optional(),
  // Days daily check-in/out selfies are retained before the cleanup job deletes them.
  image_retention_days: z.number().int().min(1).max(3650).optional(),
  // Org-level day-classification fallback for employees with NO shift assignment.
  // An assigned shift's own thresholds always win.
  min_half_day_minutes: z.number().int().min(0).max(1440).default(240),
  min_full_day_minutes: z.number().int().min(0).max(1440).default(480),
  // ── Regularization policy ──
  // How far back a member may file an attendance regularization, counted in the
  // org's timezone. 0 = today only. Mirrors the DB CHECK (0..365). A future
  // work_date is rejected unconditionally and is deliberately not a setting.
  regularization_max_backdate_days: z.number().int().min(0).max(365).default(30),
  // Levels of the reporting chain that must approve. Mirrors the DB CHECK (>= 1);
  // the upper bound is a UI sanity limit, not a DB constraint.
  regularization_approval_levels: z.number().int().min(1).max(5).default(1),
  // Which row this writes: the org's own override, or the tenant-wide default
  // that every org without an override falls back to. Same switch as
  // leaveSettingsSchema; 'tenant' additionally requires a tenant_admin platform
  // role, checked server-side in attendance.service.updateRules.
  scope: z.enum(['org', 'tenant']).default('org'),
}).superRefine(checkThresholdOrder);

// ── Shifts ──────────────────────────────────────────────────────────────────
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM or HH:MM:SS');

// One slot of a split shift, e.g. 09:00-13:00. seq orders them within the day.
const shiftSegmentSchema = z.object({
  seq: z.number().int().min(1).max(12),
  start_time: timeString,
  end_time: timeString,
});

const MINUTES_PER_DAY = 1440;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  return h! * 60 + m!;
}

/** Minutes elapsed from the shift's start, wrapping across midnight. */
function fromShiftStart(minutes: number, shiftStartMin: number): number {
  return ((minutes - shiftStartMin) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Segment-set rules that no single-column check can express. Mirrors
 * validateSegments in hr-service/src/lib/attendance/segments.ts so the client and
 * the server reject the same input, and so a night shift whose segments wrap
 * midnight is judged in the same normalized space rather than rejected outright.
 */
function checkSegments(
  v: {
    is_split?: boolean | undefined;
    segments?: Array<{ seq: number; start_time: string; end_time: string }> | undefined;
    start_time?: string | undefined;
    end_time?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (!v.is_split) return;

  const segments = v.segments ?? [];
  const add = (message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['segments'], message });

  if (segments.length < 2) {
    add('A split shift needs at least 2 segments.');
    return;
  }
  // On a partial update the window may not be in the payload; the server
  // re-validates against the stored row, so skip the window checks here.
  if (!v.start_time || !v.end_time) return;

  const shiftStartMin = toMinutes(v.start_time);
  let windowEnd = fromShiftStart(toMinutes(v.end_time), shiftStartMin);
  if (windowEnd === 0) windowEnd = MINUTES_PER_DAY;

  const seqs = new Set<number>();
  const ranges: Array<{ seq: number; start: number; end: number }> = [];

  for (const seg of segments) {
    if (seqs.has(seg.seq)) {
      add(`Duplicate segment order ${seg.seq}.`);
      return;
    }
    seqs.add(seg.seq);

    const start = fromShiftStart(toMinutes(seg.start_time), shiftStartMin);
    let end = fromShiftStart(toMinutes(seg.end_time), shiftStartMin);
    if (end <= start) end += MINUTES_PER_DAY;

    if (end > windowEnd) {
      add(`Segment ${seg.seq} (${seg.start_time}–${seg.end_time}) falls outside the shift window ${v.start_time}–${v.end_time}.`);
      return;
    }
    ranges.push({ seq: seg.seq, start, end });
  }

  for (let i = 1; i <= segments.length; i += 1) {
    if (!seqs.has(i)) {
      add(`Segment order must run 1..${segments.length} without gaps.`);
      return;
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]!.start < ranges[i - 1]!.end) {
      add(`Segments ${ranges[i - 1]!.seq} and ${ranges[i]!.seq} overlap.`);
      return;
    }
  }
}

export const createShiftSchema = z.object({
  name: z.string().min(1).max(200),
  start_time: timeString,
  end_time: timeString,
  grace_minutes: z.number().int().min(0).max(600).default(10),
  min_half_day_minutes: z.number().int().min(0).max(1440).default(240),
  min_full_day_minutes: z.number().int().min(0).max(1440).default(480),
  is_night_shift: z.boolean().default(false),
  // A split shift works 2+ slots in a day; start_time/end_time stay the OUTER
  // window the segments must nest inside.
  is_split: z.boolean().default(false),
  segments: z.array(shiftSegmentSchema).max(12).optional(),
})
  .superRefine(checkThresholdOrder)
  .superRefine(checkSegments);

export const updateShiftSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  start_time: timeString.optional(),
  end_time: timeString.optional(),
  grace_minutes: z.number().int().min(0).max(600).optional(),
  min_half_day_minutes: z.number().int().min(0).max(1440).optional(),
  min_full_day_minutes: z.number().int().min(0).max(1440).optional(),
  is_night_shift: z.boolean().optional(),
  is_split: z.boolean().optional(),
  segments: z.array(shiftSegmentSchema).max(12).optional(),
  is_active: z.boolean().optional(),
})
  .superRefine(checkThresholdOrder)
  .superRefine(checkSegments);

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

// ── Recompute ───────────────────────────────────────────────────────────────
// Re-resolve already-resolved days. Needed because the nightly job only fills
// days that have NO row yet, so changing a shift assignment never re-classified
// the days the employee had already punched.
export const MAX_RECOMPUTE_DAYS = 92;

export const recomputeAttendanceSchema = z
  .object({
    // Omitted → every active employee in the org.
    user_id: z.string().uuid().optional(),
    from: dateString,
    to: dateString,
  })
  .superRefine((d, ctx) => {
    if (d.from > d.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"from" must be on or before "to"', path: ['to'] });
      return;
    }
    // A whole-org recompute is O(employees × days); cap the window so a typo
    // cannot start a run that holds a transaction open for hours.
    const days = Math.round((Date.parse(d.to) - Date.parse(d.from)) / 86_400_000) + 1;
    if (days > MAX_RECOMPUTE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Range too large: ${days} days (max ${MAX_RECOMPUTE_DAYS})`,
        path: ['to'],
      });
    }
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

// Editing a still-pending request. `work_date` is deliberately absent: moving a
// request to another date is a different request (and would collide with the
// one-open-per-date index), so the requester cancels and files a new one.
export const updateRegularizationSchema = z
  .object({
    requested_status_name: z
      .enum(['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'wfh'])
      .nullable()
      .optional(),
    requested_in: z.string().datetime({ offset: true }).nullable().optional(),
    requested_out: z.string().datetime({ offset: true }).nullable().optional(),
    reason: z.string().min(1).max(1000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const approveRegularizationSchema = z.object({
  comment: z.string().max(1000).optional(),
});

export const rejectRegularizationSchema = z.object({
  comment: z.string().min(1).max(1000),
});

export const listRegularizationsSchema = z.object({
  scope: z.enum(['own', 'team']).default('own'),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Face verification (enrollment + review queue) ───────────────────────────
// Enrollment no longer carries the image: the reference photo is the user's
// avatar (iam.users.photo_key), uploaded first via identity-service. Enroll
// reads that stored photo and registers it with CompreFace, so the avatar and
// the biometric reference are guaranteed to be the same image.
export const faceEnrollSchema = z.object({
  user_id: z.string().uuid(),
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

// Every punch of one employee's work date. A split shift has 4+ punches, but the
// team view only ever exposes the first check-in and last check-out, so without
// this the middle punches' selfies are stored yet unreachable.
export const dayEventsQuerySchema = z.object({
  user_id: z.string().uuid(),
  date: dateString,
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
export type RecomputeAttendanceInput = z.infer<typeof recomputeAttendanceSchema>;
export type CreateRegularizationInput = z.infer<typeof createRegularizationSchema>;
export type UpdateRegularizationInput = z.infer<typeof updateRegularizationSchema>;
export type ApproveRegularizationInput = z.infer<typeof approveRegularizationSchema>;
export type RejectRegularizationInput = z.infer<typeof rejectRegularizationSchema>;
export type ListRegularizationsInput = z.infer<typeof listRegularizationsSchema>;
export type AttendanceMeQueryInput = z.infer<typeof attendanceMeQuerySchema>;
export type AttendanceTeamQueryInput = z.infer<typeof attendanceTeamQuerySchema>;
export type ReportsSummaryQueryInput = z.infer<typeof reportsSummaryQuerySchema>;
export type DayEventsQueryInput = z.infer<typeof dayEventsQuerySchema>;
