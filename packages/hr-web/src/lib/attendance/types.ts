// Attendance-module domain types (web side). These mirror the hr-service
// attendance API response shapes (services/hr-service/src/api/v1/attendance)
// and packages/validation/src/attendance.ts. Kept in apps/web — @platform/ui-kit stays
// domain-agnostic.

export type AttendanceStatusName =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'on_leave'
  | 'holiday'
  | 'weekly_off'
  | 'wfh'
  | 'not_marked';

export interface AttendanceRules {
  geofence_enabled: boolean;
  geofence_radius_meters: number;
  require_photo: boolean;
  require_geo: boolean;
  allow_wfh_checkin: boolean;
  require_face_match: boolean;
  face_match_threshold: number;
  face_match_action: string;
  // Min days before a member may self-change their reference photo (admins bypass).
  photo_change_cooldown_days: number;
  // Days daily check-in/out selfies are retained before the cleanup job deletes them.
  image_retention_days: number;
  // Org-level day classification for employees with NO shift assignment (an
  // assigned shift's own thresholds win). Below the half-day floor a day with
  // punches is marked Absent, not Half Day.
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  // Org IANA timezone; use it with todayIso(tz) so the client's "today" matches
  // the server-computed attendance work_date.
  timezone: string;
}

// Self-service enrollment context (GET /hr/attendance/face/me) — drives the
// check-in gate and the photo-upload modal.
export interface FaceSelfContext {
  user_id: string;
  has_photo: boolean;
  enrolled: boolean;
  require_face_match: boolean;
  cooldown_days: number;
  can_change_photo: boolean;
  next_change_allowed_at: string | null;
}

export interface PunchResult {
  event_id: string;
  work_date: string;
  event_type: 'check_in' | 'check_out';
  distance_from_org_m: number | null;
  is_within_geofence: boolean | null;
  is_wfh: boolean;
  photo_url: string | null;
  day_status: string;
}

export interface AttendanceDayRow {
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number | null;
  status_name: AttendanceStatusName;
  status_label: string;
  is_late: boolean;
  is_early_exit: boolean;
  // A punch landed outside the shift's declared segments (split shifts).
  has_off_window_punch: boolean;
  // A check-in was never closed; that session contributed zero minutes.
  has_open_session: boolean;
  // A punch is awaiting face review. Its minutes are WITHHELD until a reviewer
  // clears it, so this is what explains an otherwise unexplained short day.
  has_pending_face_review: boolean;
  leave_request_id: string | null;
  resolution_source: string | null;
}

export interface MonthHoliday {
  d: string;
  name: string;
}

export interface MyMonthResponse {
  month: string;
  days: AttendanceDayRow[];
  holidays: MonthHoliday[];
  weekly_off_pattern: number[];
}

// NULL when face matching passed or was not required. 'pending' punches do not
// count toward the day until a reviewer clears them.
export type FaceReviewStatus = 'pending' | 'cleared' | 'rejected' | null;

// One punch of an employee's work date. Unlike TeamDayRow — which carries only
// the day's first check-in and last check-out — this covers every punch, so a
// split shift's middle punches (and their selfies) are reachable.
export interface DayEventView {
  event_id: string;
  event_type: 'check_in' | 'check_out';
  occurred_at: string;
  face_match_score: number | null;
  face_match_passed: boolean | null;
  face_review_status: FaceReviewStatus;
  is_off_segment: boolean | null;
  is_within_geofence: boolean | null;
  distance_from_org_m: number | null;
  geo_lat: number | null;
  geo_lng: number | null;
  has_photo: boolean;
}

// A punch awaiting a face-match decision, as listed by the review queue.
export interface FaceReviewView {
  event_id: string;
  user_id: string;
  user_full_name: string | null;
  user_email: string | null;
  event_type: 'check_in' | 'check_out';
  occurred_at: string;
  face_match_score: number | null;
  face_review_status: FaceReviewStatus;
  photo_url: string | null;
  reference_photo_url: string | null;
}

export interface TeamDayRow {
  user_id: string;
  user_full_name: string;
  user_email: string;
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number | null;
  status_name: AttendanceStatusName;
  status_label: string;
  is_late: boolean;
  is_early_exit: boolean;
  has_off_window_punch: boolean;
  has_open_session: boolean;
  // Day-level: true when ANY punch of the day awaits face review. The
  // face_match_score below comes only from the check-in matching first_in, so on
  // a split shift it is blind to the middle punches — this flag is not.
  has_pending_face_review: boolean;
  // Face-attendance columns (present when the org uses face matching).
  has_photo: boolean;
  enrolled: boolean;
  face_match_score: number | null;
  face_review_status: FaceReviewStatus;
  checkin_event_id: string | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkout_event_id: string | null;
  checkout_lat: number | null;
  checkout_lng: number | null;
}

// One slot of a split shift, e.g. 09:00-13:00. seq orders them within the day.
export interface ShiftSegmentView {
  seq: number;
  start_time: string;
  end_time: string;
}

export interface ShiftView {
  id: string;
  org_id: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  is_night_shift: boolean;
  // A split shift works 2+ slots a day; start_time/end_time stay the OUTER
  // window its segments nest inside. Empty segments for a non-split shift.
  is_split: boolean;
  segments: ShiftSegmentView[];
  is_active: boolean;
}

export interface ShiftAssignmentView {
  id: string;
  user_id: string;
  user_full_name: string;
  shift_id: string;
  shift_name: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

export type RegularizationStatus = 'pending' | 'approved' | 'rejected';

export interface RegularizationView {
  id: string;
  user_id: string;
  user_full_name?: string;
  work_date: string;
  requested_status_id: string | null;
  requested_status_name: AttendanceStatusName | null;
  requested_in: string | null;
  requested_out: string | null;
  reason: string;
  status: RegularizationStatus;
  approver_id: string | null;
  acted_at: string | null;
  approver_comment: string | null;
  created_at: string;
}

export interface MonthlySummaryRow {
  user_id: string;
  user_full_name: string;
  user_email: string;
  month: string;
  present_count: number;
  absent_count: number;
  half_day_count: number;
  on_leave_count: number;
  holiday_count: number;
  weekly_off_count: number;
  wfh_count: number;
  late_count: number;
  early_exit_count: number;
  avg_worked_minutes: number | null;
}
