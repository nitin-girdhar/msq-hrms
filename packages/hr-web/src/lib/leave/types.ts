// Leave-module domain types (web side). These mirror the hr-service leave API
// response shapes (services/hr-service/src/api/v1/leave) and the
// hr.vw_leave_requests_enriched / hr.vw_leave_balances views. Kept in apps/web —
// @platform/ui-kit stays domain-agnostic.

export type HalfDay = 'full' | 'first_half' | 'second_half';

export type LeaveStatusName =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'withdrawn';

export interface LeaveBalance {
  user_id: string;
  org_id: string;
  leave_type_id: string;
  leave_type_name: string;
  leave_type_label: string;
  is_paid: boolean;
  balance: number;
}

export interface LeaveRequestView {
  id: string;
  user_id: string;
  user_full_name: string;
  user_email: string;
  org_id: string;
  leave_type_id: string;
  leave_type_name: string;
  leave_type_label: string;
  start_date: string;
  end_date: string;
  start_half: HalfDay;
  end_half: HalfDay;
  days_count: number;
  reason: string | null;
  status_id: string;
  status_name: LeaveStatusName;
  status_label: string;
  document_url: string | null;
  is_open: boolean;
  latest_approval_level: number | null;
  latest_approver_id: string | null;
  latest_approval_action: string | null;
  latest_approval_acted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeavePreview {
  days_count: number;
  balance: number;
  is_paid: boolean;
  allow_half_day: boolean;
  requires_document_after_days: number | null;
  max_consecutive_days: number | null;
  min_notice_days: number;
  sufficient: boolean;
  warnings: string[];
}

export type AccrualFrequency = 'monthly' | 'quarterly' | 'yearly' | 'none';

export interface LeavePolicyView {
  id: string;
  tenant_id: string;
  org_id: string | null;
  leave_type_id: string;
  leave_type_name: string;
  leave_type_label: string;
  accrual_frequency: AccrualFrequency;
  accrual_amount: number;
  max_balance: number | null;
  carry_forward: boolean;
  max_carry_forward: number | null;
  max_consecutive_days: number | null;
  min_notice_days: number;
  allow_half_day: boolean;
  requires_document_after_days: number | null;
  approval_levels: number;
  applicable_from: string;
  is_active: boolean;
}

export interface HolidayCalendarView {
  id: string;
  org_id: string;
  name: string;
  year: number;
  is_active: boolean;
}

export interface HolidayView {
  id: string;
  calendar_id: string;
  org_id: string;
  holiday_date: string;
  name: string;
  is_optional: boolean;
  is_active: boolean;
}

export interface LeaveSettings {
  leave_cycle_start_month: number;
}

export interface EmployeeProfileView {
  user_id: string;
  full_name: string;
  email: string;
  employee_code: string | null;
  date_of_joining: string | null;
  date_of_exit: string | null;
  department_id: string | null;
  department_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  weekly_off_pattern: number[] | null;
}

export interface HrLookupOption {
  id: string;
  name: string;
}
