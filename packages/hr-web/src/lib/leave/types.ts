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

// The whole employee-facing leave payload: the balance per type as on a date,
// and the two facts the apply form needs about it. Everything else the server
// knows about a leave policy — accrual, carry-forward, caps, approval depth —
// stays behind hr.leave.admin.policies.view and never reaches this app.
export interface LeaveBalance {
  leave_type_id: string;
  leave_type_name: string;
  leave_type_label: string;
  is_paid: boolean;
  balance: number;
  allow_half_day: boolean;
  // False for a type that only carries a residual balance from a withdrawn
  // policy: still worth showing, no longer bookable.
  has_policy: boolean;
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
  /** The approver's open question to the requester (cleared when the requester edits). */
  info_requested_at?: string | null;
  info_request_note?: string | null;
  /** Approval window of the effective policy, in hours. */
  sla_hours?: number | null;
  /** Apply page (1.67.0): the readable number (shown LV-1001), the covering colleague, the uploaded file and the reviewer. */
  request_no?: number;
  handover_user_id?: string | null;
  handover_name?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
  latest_approver_name?: string | null;
  /** Approval chain progress (list endpoints only). */
  approval_levels_total?: number;
  approval_levels_approved?: number;
  pending_level?: number | null;
  pending_approver_id?: string | null;
  pending_approver_name?: string | null;
  /** People who actually approved, in level order, each named once. */
  approved_by_names?: string[];
}

export type ApprovalAction = 'pending' | 'approved' | 'rejected';

export interface LeaveApprovalStep {
  level: number;
  approver_id: string;
  approver_name: string;
  action: ApprovalAction;
  acted_at: string | null;
  comment: string | null;
  /** Who actually decided; differs from approver_name when an admin overrode. */
  acted_by_id?: string | null;
  acted_by_name?: string | null;
  /** Set when the level was handed on because its original approver covered a lower level. */
  reassigned_from_name?: string | null;
}

export interface ApprovalPendingWith {
  level: number;
  approver_id: string;
  approver_name: string;
}

/** What the approver's Review dialog needs: the chain and whether this viewer may decide it now. */
export interface ApprovalReview {
  approval_chain: LeaveApprovalStep[];
  pending_with: ApprovalPendingWith | null;
  my_decision: { can_decide: boolean; covering: boolean; reason: string | null };
}

export interface LeaveRequestDetail extends LeaveRequestView {
  approval_chain: LeaveApprovalStep[];
  pending_with: ApprovalPendingWith | null;
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
  sla_hours?: number;
  encashable?: boolean;
  max_encash_days?: number | null;
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
  grade?: string | null;
  squad?: string | null;
  cost_center?: string | null;
  notice_period_days?: number | null;
  work_mode?: 'office' | 'hybrid' | 'remote' | null;
  seat_label?: string | null;
  shift_name?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  on_leave_today?: boolean;
  /** Other active branches this person works in (the profile itself is home-branch only). */
  other_branches?: Array<{ id: string; name: string }>;
  /** Set when a home-branch move could not carry the designation across; cleared when HR picks one. */
  designation_needs_review?: boolean;
  is_active?: boolean;
  exit_reason?: string | null;
  employment_type_name?: string | null;
  probation_end_date?: string | null;
}

export interface HrLookupOption {
  id: string;
  name: string;
}

export interface BulkLeaveResult {
  request_id: string;
  ok: boolean;
  /** Why the request was skipped (only on ok: false). */
  error?: string;
}

export interface BulkLeaveOutcome {
  decision: 'approve' | 'reject';
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkLeaveResult[];
}

export interface CompOffClaim {
  id: string;
  user_id: string;
  user_full_name: string;
  user_email: string;
  /** The day off the employee worked (YYYY-MM-DD). */
  worked_date: string;
  /** 1 (full day) or 0.5 (half day). */
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approver_id: string | null;
  approver_name: string | null;
  acted_at: string | null;
  approver_comment: string | null;
  /** Set on approval: the last day the credit is usable. */
  expires_on: string | null;
  /** Set once the credit has lapsed unused. */
  lapsed_at: string | null;
  created_at: string;
}
