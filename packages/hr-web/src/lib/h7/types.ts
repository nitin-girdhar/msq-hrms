// Shapes for leave SLA / encashment / policy summary, statutory details, change requests,
// the Employee 360 tabs, org chart and attendance tools (schema 1.64.0). snake_case.

export interface PolicySummaryRow {
  leave_type_name: string;
  leave_type_label: string;
  is_paid: boolean;
  max_consecutive_days: number | null;
  min_notice_days: number;
  allow_half_day: boolean;
  requires_document_after_days: number | null;
  carry_forward: boolean;
  encashable: boolean;
  max_encash_days: number | null;
  sla_hours: number;
}

export interface Encashment {
  id: string;
  user_id: string;
  user_full_name: string;
  user_email: string;
  leave_type_label: string;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approver_name: string | null;
  acted_at: string | null;
  approver_comment: string | null;
  created_at: string;
}

export interface StatutoryValues {
  pan: string | null;
  aadhaar: string | null;
  uan: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_number: string | null;
  ifsc: string | null;
  account_type: string | null;
  tax_regime: string | null;
}

/** The form's wire shape: every field a string, '' meaning "clear". */
export type StatutoryForm = { [K in keyof StatutoryValues]: string };

export interface StatutoryView {
  /** Always present for anyone who can open the profile: identifiers hidden except the last four. */
  masked: StatutoryValues | null;
  /** Only for hr.employees.statutory.manage. */
  values: StatutoryValues | null;
}

export interface ChangeRequest {
  id: string;
  user_id?: string;
  user_full_name?: string;
  section: string;
  payload: Partial<Record<keyof StatutoryValues, string>>;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewer_comment: string | null;
  acted_at: string | null;
  created_at: string;
}

export interface Employee360AttendanceRow {
  work_date: string;
  status_name: string;
  status_label: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number | null;
  is_late: boolean;
  is_early_exit: boolean;
  has_open_session: boolean;
}

export interface AuditEntry {
  id: string;
  action_type: string;
  performed_by_name: string | null;
  created_at: string;
}

export interface OrgChartPerson {
  user_id: string;
  full_name: string;
  manager_id: string | null;
  designation_name: string | null;
  department_name: string | null;
}

export interface PunchLogRow {
  id: string;
  event_type: 'check_in' | 'check_out';
  occurred_at: string;
  source: string;
  distance_from_org_m: number | null;
  is_within_geofence: boolean | null;
  is_wfh: boolean;
  geo_exception_type: string | null;
  face_match_score: number | null;
  face_match_passed: boolean | null;
  face_review_status: string | null;
  is_off_segment: boolean | null;
}

export interface Nudge {
  id: string;
  from_name: string | null;
  created_at: string;
  work_date: string | null;
}

export interface BulkRegularizeOutcome {
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{ user_id: string; ok: boolean; error?: string }>;
}

export const STATUTORY_LABELS: Record<keyof StatutoryValues, string> = {
  pan: 'PAN',
  aadhaar: 'Aadhaar',
  uan: 'UAN',
  bank_name: 'Bank',
  bank_branch: 'Branch',
  account_number: 'Account number',
  ifsc: 'IFSC',
  account_type: 'Account type',
  tax_regime: 'Tax regime',
};

export const EMPTY_STATUTORY_FORM: StatutoryForm = {
  pan: '', aadhaar: '', uan: '', bank_name: '', bank_branch: '', account_number: '', ifsc: '', account_type: '', tax_regime: '',
};

export const toStatutoryForm = (v: StatutoryValues | null): StatutoryForm => ({
  pan: v?.pan ?? '', aadhaar: v?.aadhaar ?? '', uan: v?.uan ?? '', bank_name: v?.bank_name ?? '', bank_branch: v?.bank_branch ?? '',
  account_number: v?.account_number ?? '', ifsc: v?.ifsc ?? '', account_type: v?.account_type ?? '', tax_regime: v?.tax_regime ?? '',
});

/** Hide all but the last four characters (the same rule the server uses for the masked view). */
export function maskTail(value: string | null | undefined, keep = 4): string {
  if (!value) return '—';
  return value.length <= keep ? '•'.repeat(value.length) : '•'.repeat(value.length - keep) + value.slice(-keep);
}

/** Readable label for an audit action_type: 'employee_note_added' → 'Employee note added'. */
export function auditLabel(action: string): string {
  const s = action.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Where a pending leave request stands against its approval window.
 * `hoursLeft` is negative once overdue. The window is a countdown for the approver, never an
 * auto-decision.
 */
export function slaState(createdAt: string, slaHours: number | null | undefined, now = Date.now()): { label: string; tone: 'ok' | 'due' | 'overdue' } | null {
  if (!slaHours) return null;
  const hoursLeft = (Date.parse(createdAt) + slaHours * 3_600_000 - now) / 3_600_000;
  const abs = Math.abs(hoursLeft);
  const text = abs >= 48 ? `${Math.round(abs / 24)}d` : abs >= 1 ? `${Math.floor(abs)}h` : `${Math.max(1, Math.round(abs * 60))}m`;
  if (hoursLeft < 0) return { label: `Overdue by ${text}`, tone: 'overdue' };
  return { label: `Due in ${text}`, tone: hoursLeft <= 6 ? 'due' : 'ok' };
}
