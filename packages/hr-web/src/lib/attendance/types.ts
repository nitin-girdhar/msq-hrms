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
