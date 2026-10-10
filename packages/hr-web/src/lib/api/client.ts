// HR / platform-module API namespace. Built on the same generic fetch wrapper
// (@platform/ui-kit `createApiClient`) as the CRM `client.ts`, but kept in a separate file
// because it is HR domain knowledge (leave, holidays, employees). Paths are the
// gateway prefixes — Next.js rewrites `/api/:path*` → gateway `/:path*`
// (apps/web/next.config.ts), so `/hr/leave/*` reaches hr-service via the gateway.

import { createApiClient } from '@platform/ui-kit';
import type {
  LeaveBalance,
  LeaveRequestView,
  LeaveRequestDetail,
  ApprovalReview,
  LeavePreview,
  LeavePolicyView,
  HolidayView,
  HolidayCalendarView,
  LeaveSettings,
  HalfDay,
  EmployeeProfileView,
  HrLookupOption,
  BulkLeaveOutcome,
  CompOffClaim,
} from '../leave/types';
import type { Roster, ShiftSwap } from '../team/types';
import type { Announcement, Asset, MyAsset } from '../extras/types';
import type {
  AuditEntry, BulkRegularizeOutcome, ChangeRequest, Employee360AttendanceRow, Encashment, Nudge,
  OrgChartPerson, PolicySummaryRow, PunchLogRow, StatutoryForm, StatutoryView, StatutoryValues,
} from '../h7/types';
import type { EmployeeDocument, PendingDocument, UploadDocumentBody } from '../documents/types';
import type { ApplyShiftsBody, ApplyShiftsOutcome, PlannerWeek, ReallocateBody } from '../planner/types';
import type { PayrollOverview, PayrollReadiness, PayslipDetail, PayslipSummary } from '../payroll/types';
import type {
  Employee360,
  MyProfile,
  PersonalForm,
  EmergencyContact,
  EmployeeNote,
} from '../profile/types';
import type {
  AttendanceRules,
  PunchResult,
  MyMonthResponse,
  TodayPunchState,
  TeamDayRow,
  ShiftView,
  ShiftSegmentView,
  ShiftAssignmentView,
  GeoExceptionView,
  GeoExceptionType,
  DayEventView,
  FaceReviewView,
  RegularizationView,
  RegularizationDetail,
  RegularizationApprovalReview,
  MonthlySummaryRow,
  MusterReport,
  MusterParams,
  FaceSelfContext,
} from '../attendance/types';

const { request } = createApiClient('/api');

function qs(params: object): string {
  const s = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return s ? `?${s}` : '';
}

interface Envelope<T> {
  success: true;
  data: T;
}
interface ListEnvelope<T> {
  success: true;
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Leave ─────────────────────────────────────────────────────────────────────

export interface ApplyLeaveBody {
  leave_type_name: string;
  start_date: string;
  end_date: string;
  start_half: HalfDay;
  end_half: HalfDay;
  reason?: string | undefined;
  document_url?: string | undefined;
  /** The colleague covering the work. */
  handover_user_id?: string | null | undefined;
  /** From uploadAttachment: the token and the name to show. */
  attachment_token?: string | null | undefined;
  attachment_name?: string | null | undefined;
}

export interface PreviewParams {
  leave_type_name: string;
  start_date: string;
  end_date: string;
  start_half: HalfDay;
  end_half: HalfDay;
}

export interface ListRequestsParams {
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface CreatePolicyBody {
  leave_type_name: string;
  org_id?: string | null;
  accrual_frequency: string;
  accrual_amount: number;
  max_balance?: number | null;
  carry_forward: boolean;
  max_carry_forward?: number | null;
  max_consecutive_days?: number | null;
  min_notice_days: number;
  allow_half_day: boolean;
  requires_document_after_days?: number | null;
  approval_levels: number;
  sla_hours?: number;
  encashable?: boolean;
  max_encash_days?: number | null;
  applicable_from: string;
}

export interface CreateAdjustmentBody {
  user_id: string;
  leave_type_name: string;
  amount: number;
  note: string;
  effective_date?: string | undefined;
}

export const leave = {
  // as_of dates the balance and the policy behind it; omit it for "right now".
  balances: (params: { as_of?: string } = {}) =>
    request<Envelope<LeaveBalance[]>>(`/hr/leave/balances${qs(params)}`),

  balancesForUser: (userId: string, params: { as_of?: string } = {}) =>
    request<Envelope<LeaveBalance[]>>(`/hr/leave/balances/${userId}${qs(params)}`),

  myRequests: (params: ListRequestsParams = {}) =>
    request<ListEnvelope<LeaveRequestView>>(`/hr/leave/requests${qs(params)}`),

  getById: (id: string) => request<Envelope<LeaveRequestDetail>>(`/hr/leave/requests/${id}`),

  // Approver-side chain + whether the caller may decide it now.
  approvals: (id: string) => request<Envelope<ApprovalReview>>(`/hr/leave/requests/${id}/approvals`),

  teamRequests: (params: ListRequestsParams = {}) =>
    request<ListEnvelope<LeaveRequestView>>(`/hr/leave/requests/team${qs(params)}`),

  preview: (params: PreviewParams) =>
    request<Envelope<LeavePreview>>(`/hr/leave/requests/preview${qs(params)}`),

  uploadAttachment: (body: { file_name: string; data_base64: string }) =>
    request<Envelope<{ token: string; name: string; mime: string; size: number }>>('/hr/leave/attachments', { method: 'POST', body: JSON.stringify(body) }),
  /** Authenticated, same-origin; opened in a new tab. */
  attachmentUrl: (requestId: string) => `/api/hr/leave/requests/${requestId}/attachment`,

  apply: (body: ApplyLeaveBody) =>
    request<Envelope<{ id: string; days_count: number; level1_approver_id: string | null }>>(
      '/hr/leave/requests',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Amend a request that is still pending. Whole-request body, not a patch of
  // changed fields — the server re-validates the request as a unit.
  update: (id: string, body: ApplyLeaveBody) =>
    request<Envelope<{ days_count: number; level1_approver_id: string | null }>>(
      `/hr/leave/requests/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  approve: (id: string, comment?: string) =>
    request<Envelope<unknown>>(`/hr/leave/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),

  reject: (id: string, comment: string) =>
    request<Envelope<unknown>>(`/hr/leave/requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),

  // One decision across many pending requests. Not atomic: a request that cannot
  // be decided is reported in `results` and the rest still apply.
  bulkDecide: (body: { request_ids: string[]; decision: 'approve' | 'reject'; comment?: string }) =>
    request<Envelope<BulkLeaveOutcome>>('/hr/leave/requests/bulk-decision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancel: (id: string, comment?: string) =>
    request<Envelope<{ id: string }>>(`/hr/leave/requests/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),

  policies: (params: { leave_type_name?: string } = {}) =>
    request<Envelope<LeavePolicyView[]>>(`/hr/leave/policies${qs(params)}`),

  createPolicy: (body: CreatePolicyBody) =>
    request<Envelope<{ id: string }>>('/hr/leave/policies', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updatePolicy: (id: string, body: Record<string, unknown>) =>
    request<void>(`/hr/leave/policies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  adjustment: (body: CreateAdjustmentBody) =>
    request<Envelope<{ id: string }>>('/hr/leave/adjustments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSettings: () => request<Envelope<LeaveSettings>>('/hr/leave/settings'),

  updateSettings: (body: { leave_cycle_start_month: number; scope: 'org' | 'tenant' }) =>
    request<void>('/hr/leave/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

// ── Holidays & calendars ────────────────────────────────────────────────────

// ── Leave info/encashment/policy summary, statutory, tools (schema 1.64.0) ────
export const leaveExtras = {
  /** The approver asks the requester a question; the request stays pending. */
  requestInfo: (id: string, comment: string) =>
    request<void>(`/hr/leave/requests/${id}/request-info`, { method: 'POST', body: JSON.stringify({ comment }) }),
  /** What an employee needs to know to apply well (no accrual figures). */
  policySummary: () => request<Envelope<PolicySummaryRow[]>>('/hr/leave/policy-summary'),
};

export const encashments = {
  create: (body: { leave_type_name: string; days: number; reason?: string }) =>
    request<Envelope<{ id: string }>>('/hr/leave/encashments', { method: 'POST', body: JSON.stringify(body) }),
  mine: () => request<Envelope<Encashment[]>>('/hr/leave/encashments'),
  queue: (status: Encashment['status'] = 'pending') => request<Envelope<Encashment[]>>(`/hr/leave/encashments/queue${qs({ status })}`),
  approve: (id: string, comment?: string) =>
    request<Envelope<unknown>>(`/hr/leave/encashments/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment }) }),
  reject: (id: string, comment: string) =>
    request<Envelope<unknown>>(`/hr/leave/encashments/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) }),
  cancel: (id: string) => request<Envelope<unknown>>(`/hr/leave/encashments/${id}/cancel`, { method: 'POST' }),
};

export const statutory = {
  /** The caller's own details (they own them). */
  mine: () => request<Envelope<StatutoryValues | null>>('/hr/profile/me/statutory'),
  /** Masked for anyone who can open the profile; full values only with the manage capability. */
  forEmployee: (userId: string) => request<Envelope<StatutoryView>>(`/hr/employees/${userId}/statutory`),
  save: (userId: string, body: Partial<StatutoryForm>) =>
    request<void>(`/hr/employees/${userId}/statutory`, { method: 'PUT', body: JSON.stringify(body) }),
  myRequests: () => request<Envelope<ChangeRequest[]>>('/hr/profile/me/change-requests'),
  requestChange: (payload: Partial<StatutoryForm>, reason?: string) =>
    request<Envelope<{ id: string }>>('/hr/profile/me/change-requests', { method: 'POST', body: JSON.stringify({ payload, reason }) }),
  cancelRequest: (id: string) => request<void>(`/hr/profile/me/change-requests/${id}/cancel`, { method: 'POST' }),
  queue: (status: ChangeRequest['status'] = 'pending') => request<Envelope<ChangeRequest[]>>(`/hr/profile/change-requests${qs({ status })}`),
  approve: (id: string, comment?: string) =>
    request<void>(`/hr/profile/change-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment }) }),
  reject: (id: string, comment: string) =>
    request<void>(`/hr/profile/change-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) }),
};

export const employeeViews = {
  attendance: (userId: string, month: string) => request<Envelope<Employee360AttendanceRow[]>>(`/hr/employees/${userId}/attendance${qs({ month })}`),
  audit: (userId: string) => request<Envelope<AuditEntry[]>>(`/hr/employees/${userId}/audit`),
  orgChart: () => request<Envelope<OrgChartPerson[]>>('/hr/employees/org-chart'),
};

export const attendanceTools = {
  punches: (month: string) => request<Envelope<PunchLogRow[]>>(`/hr/attendance/me/punches${qs({ month })}`),
  nudges: () => request<Envelope<Nudge[]>>('/hr/attendance/me/nudges'),
  manualPunch: (body: { user_id: string; event_type: 'check_in' | 'check_out'; occurred_at: string; reason: string }) =>
    request<Envelope<{ work_date: string }>>('/hr/attendance/admin/manual-punch', { method: 'POST', body: JSON.stringify(body) }),
  bulkRegularize: (body: { user_ids: string[]; work_date: string; status_name: string; reason: string }) =>
    request<Envelope<BulkRegularizeOutcome>>('/hr/attendance/admin/bulk-regularize', { method: 'POST', body: JSON.stringify(body) }),
  nudge: (body: { user_ids: string[]; work_date: string }) =>
    request<Envelope<{ requested: number; nudged: number }>>('/hr/attendance/admin/nudge', { method: 'POST', body: JSON.stringify(body) }),
};

// ── Announcements + assets (schema 1.63.0) ────────────────────────────────────
export const announcements = {
  list: () => request<Envelope<Announcement[]>>('/hr/announcements'),
  markRead: (id: string) => request<void>(`/hr/announcements/${id}/read`, { method: 'POST' }),
  create: (body: { title: string; body: string; category: string; is_pinned: boolean; publish: boolean }) =>
    request<Envelope<{ id: string }>>('/hr/announcements', { method: 'POST', body: JSON.stringify(body) }),
  retire: (id: string) => request<void>(`/hr/announcements/${id}/retire`, { method: 'POST' }),
};

export const assets = {
  /** What the caller currently holds. */
  mine: () => request<Envelope<MyAsset[]>>('/hr/assets/mine'),
  list: () => request<Envelope<Asset[]>>('/hr/assets'),
  create: (body: { asset_tag: string; name: string; category: string; serial_no?: string }) =>
    request<Envelope<{ id: string }>>('/hr/assets', { method: 'POST', body: JSON.stringify(body) }),
  assign: (id: string, userId: string) =>
    request<void>(`/hr/assets/${id}/assign`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  returnAsset: (id: string) => request<void>(`/hr/assets/${id}/return`, { method: 'POST' }),
};

// ── Documents vault (schema 1.65.0) ───────────────────────────────────────────
// ── Roster planner (schema 1.66.0) ────────────────────────────────────────────
export const planner = {
  week: (params: { view?: string; from?: string; q?: string }) => request<Envelope<PlannerWeek>>(`/hr/attendance/planner/week${qs(params)}`),
  apply: (body: ApplyShiftsBody) =>
    request<Envelope<ApplyShiftsOutcome>>('/hr/attendance/planner/cells', { method: 'PUT', body: JSON.stringify(body) }),
  reallocate: (body: ReallocateBody) =>
    request<Envelope<ApplyShiftsOutcome>>('/hr/attendance/planner/reallocate', { method: 'POST', body: JSON.stringify(body) }),
  setRequirement: (shift_id: string, required_headcount: number) =>
    request<void>('/hr/attendance/planner/requirements', { method: 'PUT', body: JSON.stringify({ shift_id, required_headcount }) }),
  publish: (week_start: string, note?: string) =>
    request<Envelope<{ published_at: string }>>('/hr/attendance/planner/publish', { method: 'POST', body: JSON.stringify({ week_start, ...(note ? { note } : {}) }) }),
};

export const documents = {
  settings: () => request<Envelope<{ max_bytes: number }>>('/hr/documents/settings'),
  saveSettings: (max_bytes: number) => request<void>('/hr/documents/settings', { method: 'PUT', body: JSON.stringify({ max_bytes }) }),
  mine: () => request<Envelope<EmployeeDocument[]>>('/hr/documents/mine'),
  upload: (body: UploadDocumentBody) =>
    request<Envelope<{ id: string }>>('/hr/documents/mine', { method: 'POST', body: JSON.stringify(body) }),
  forEmployee: (userId: string) => request<Envelope<EmployeeDocument[]>>(`/hr/documents/employee/${userId}`),
  pending: () => request<Envelope<PendingDocument[]>>('/hr/documents/admin/pending'),
  review: (id: string, decision: 'verified' | 'rejected', note?: string) =>
    request<void>(`/hr/documents/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, ...(note ? { note } : {}) }) }),
  remove: (id: string) => request<void>(`/hr/documents/${id}`, { method: 'DELETE' }),
  /** Authenticated, same-origin; opened in a new tab. */
  fileUrl: (id: string) => `/api/hr/documents/${id}/file`,
  /** The whole folder as a ZIP: the caller's own, or (documents.manage) one employee's. */
  dossierUrl: (userId?: string) => (userId ? `/api/hr/documents/employee/${userId}/dossier` : '/api/hr/documents/mine/dossier'),
};

// ── Payroll viewer + month lock (schema 1.62.0) ───────────────────────────────
export const payroll = {
  /** The caller's own PUBLISHED payslips, newest first. */
  mine: () => request<Envelope<PayslipSummary[]>>('/hr/payroll/payslips'),
  getMine: (id: string) => request<Envelope<PayslipDetail>>(`/hr/payroll/payslips/${id}`),
  readiness: (month: string) => request<Envelope<PayrollReadiness>>(`/hr/payroll/admin/readiness${qs({ month })}`),
  overview: (month: string) => request<Envelope<PayrollOverview>>(`/hr/payroll/admin/overview${qs({ month })}`),
  saveDraft: (body: { user_id: string; month: string; working_days?: number; lop_days?: number; lines: Array<{ kind: 'earning' | 'deduction'; label: string; amount: number }> }) =>
    request<Envelope<{ id: string }>>('/hr/payroll/admin/payslips', { method: 'PUT', body: JSON.stringify(body) }),
  publish: (month: string) => request<Envelope<{ published: number }>>(`/hr/payroll/admin/${month}/publish`, { method: 'POST' }),
  lock: (month: string) => request<Envelope<{ status: string }>>(`/hr/payroll/admin/${month}/lock`, { method: 'POST' }),
  unlock: (month: string) => request<Envelope<{ status: string }>>(`/hr/payroll/admin/${month}/unlock`, { method: 'POST' }),
};

// ── Team roster + shift swaps (schema 1.61.0) ─────────────────────────────────
export const swaps = {
  /** The week's roster for the caller's team (whole branch for an attendance admin). */
  roster: (from?: string) => request<Envelope<Roster>>(`/hr/attendance/roster${qs(from ? { from } : {})}`),
  mine: () => request<Envelope<ShiftSwap[]>>('/hr/attendance/swaps'),
  queue: () => request<Envelope<ShiftSwap[]>>('/hr/attendance/swaps/queue'),
  create: (body: { peer_id: string; swap_date: string; reason: string }) =>
    request<Envelope<{ id: string }>>('/hr/attendance/swaps', { method: 'POST', body: JSON.stringify(body) }),
  respond: (id: string, accept: boolean) =>
    request<Envelope<unknown>>(`/hr/attendance/swaps/${id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) }),
  cancel: (id: string) => request<Envelope<unknown>>(`/hr/attendance/swaps/${id}/cancel`, { method: 'POST' }),
  approve: (id: string, comment?: string) =>
    request<Envelope<unknown>>(`/hr/attendance/swaps/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment }) }),
  reject: (id: string, comment: string) =>
    request<Envelope<unknown>>(`/hr/attendance/swaps/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) }),
};

// ── My profile + Employee 360 (schema 1.60.0) ────────────────────────────────
/** The caller's own recent activity for the dashboard (own rows only; the server gates each source by capability). */
export interface ActivityItem { kind: 'punch' | 'regularization' | 'leave' | 'payslip' | 'document'; title: string; detail: string | null; at: string; href: string }
export const myActivity = {
  list: () => request<Envelope<ActivityItem[]>>('/hr/me/activity'),
};

export const profile = {
  /** The caller's own personal details and emergency contacts. */
  mine: () => request<Envelope<MyProfile>>('/hr/profile/me'),

  savePersonal: (body: PersonalForm) =>
    request<void>('/hr/profile/me/personal', { method: 'PUT', body: JSON.stringify(body) }),

  addContact: (body: Omit<EmergencyContact, 'id'>) =>
    request<Envelope<{ id: string }>>('/hr/profile/me/contacts', { method: 'POST', body: JSON.stringify(body) }),

  updateContact: (id: string, body: Partial<Omit<EmergencyContact, 'id'>>) =>
    request<void>(`/hr/profile/me/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeContact: (id: string) => request<void>(`/hr/profile/me/contacts/${id}`, { method: 'DELETE' }),
};

export const employee360 = {
  get: (userId: string) => request<Envelope<Employee360>>(`/hr/employees/${userId}/profile-360`),

  addNote: (userId: string, body: { kind: EmployeeNote['kind']; body: string }) =>
    request<Envelope<{ id: string }>>(`/hr/employees/${userId}/notes`, { method: 'POST', body: JSON.stringify(body) }),
};

// ── Comp-off (schema 1.59.0) ──────────────────────────────────────────────────
export const compOff = {
  claim: (body: { worked_date: string; days: 0.5 | 1; reason: string }) =>
    request<Envelope<{ id: string; approver_id: string | null }>>('/hr/leave/comp-off', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** The caller's own claims, newest first. */
  mine: () => request<Envelope<CompOffClaim[]>>('/hr/leave/comp-off'),

  /** Claims this approver may decide (scope is the server's). */
  queue: (status: CompOffClaim['status'] = 'pending') =>
    request<Envelope<CompOffClaim[]>>(`/hr/leave/comp-off/queue${qs({ status })}`),

  approve: (id: string, comment?: string) =>
    request<Envelope<unknown>>(`/hr/leave/comp-off/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),

  reject: (id: string, comment: string) =>
    request<Envelope<unknown>>(`/hr/leave/comp-off/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),

  cancel: (id: string) =>
    request<Envelope<{ id: string }>>(`/hr/leave/comp-off/${id}/cancel`, { method: 'POST' }),
};

export const holidays = {
  list: (params: { year?: number; calendar_id?: string } = {}) =>
    request<Envelope<HolidayView[]>>(`/hr/holidays${qs(params)}`),

  create: (body: { calendar_id: string; holiday_date: string; name: string; is_optional: boolean }) =>
    request<Envelope<{ id: string }>>('/hr/holidays', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: Record<string, unknown>) =>
    request<void>(`/hr/holidays/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

export const holidayCalendars = {
  list: () => request<Envelope<HolidayCalendarView[]>>('/hr/holiday-calendars'),

  create: (body: { name: string; year: number }) =>
    request<Envelope<{ id: string }>>('/hr/holiday-calendars', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: Record<string, unknown>) =>
    request<void>(`/hr/holiday-calendars/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ── Employee profiles & lookups ─────────────────────────────────────────────

/** The directory list: one page of people plus the header numbers for the filters in force. */
export interface DirectoryEnvelope extends ListEnvelope<EmployeeProfileView> {
  meta?: { active: number; exited: number; all: number; with_shift: number; on_leave: number; joined_this_month: number; departments: Array<{ name: string; count: number }> };
}

export const hrEmployees = {
  // The endpoint paginates (default limit 20), so callers that need the full
  // roster — e.g. the shift-assignment picker — must pass an explicit limit.
  list: (params: { page?: number; limit?: number; search?: string; department?: string; status?: 'active' | 'exited' | 'all' } = {}) =>
    request<DirectoryEnvelope>(`/hr/employees${qs(params)}`),

  get: (userId: string) => request<Envelope<EmployeeProfileView>>(`/hr/employees/${userId}`),

  create: (body: Record<string, unknown>) =>
    request<Envelope<{ user_id: string }>>('/hr/employees', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (userId: string, body: Record<string, unknown>) =>
    request<Envelope<EmployeeProfileView>>(`/hr/employees/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  departments: {
    list: () => request<Envelope<HrLookupOption[]>>('/hr/employees/departments'),
    create: (body: { name: string }) =>
      request<Envelope<{ id: string }>>('/hr/employees/departments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  designations: {
    list: () => request<Envelope<HrLookupOption[]>>('/hr/employees/designations'),
    create: (body: { name: string }) =>
      request<Envelope<{ id: string }>>('/hr/employees/designations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
};

// ── Attendance ───────────────────────────────────────────────────────────────

export interface PunchBody {
  geo_lat?: number | undefined;
  geo_lng?: number | undefined;
  geo_accuracy_m?: number | undefined;
  photo?: string | undefined;
  source: 'web' | 'mobile';
  is_wfh: boolean;
}

export interface CreateRegularizationBody {
  work_date: string;
  requested_status_name?: string | undefined;
  requested_in?: string | undefined;
  requested_out?: string | undefined;
  reason: string;
}

// work_date is not editable — a different date is a different request, and the
// one-open-per-date rule would reject it anyway. Cancel and file a new one.
export interface UpdateRegularizationBody {
  requested_status_name?: string | null | undefined;
  requested_in?: string | null | undefined;
  requested_out?: string | null | undefined;
  reason?: string | undefined;
}

export interface ListRegularizationsParams {
  scope?: 'own' | 'team' | undefined;
  status?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export const attendance = {
  checkIn: (body: PunchBody) =>
    request<Envelope<PunchResult>>('/hr/attendance/check-in', { method: 'POST', body: JSON.stringify(body) }),

  checkOut: (body: PunchBody) =>
    request<Envelope<PunchResult>>('/hr/attendance/check-out', { method: 'POST', body: JSON.stringify(body) }),

  getRules: () => request<Envelope<AttendanceRules>>('/hr/attendance/rules'),
  // The admin read: gated on hr.attendance.admin.rules.view, which an HR admin
  // can hold without hr.attendance.view.
  getAdminRules: () => request<Envelope<AttendanceRules>>('/hr/attendance/rules/admin'),

  // `scope` is write-only and deliberately absent from AttendanceRules: it says
  // WHICH row to write (this org's override, or the tenant-wide default others
  // inherit), not what the rules are. The response is always the effective rules
  // for the caller's own org, whichever row was written.
  updateRules: (body: Partial<AttendanceRules> & { scope?: 'org' | 'tenant' }) =>
    request<Envelope<AttendanceRules>>('/hr/attendance/rules/admin', { method: 'PUT', body: JSON.stringify(body) }),

  me: (params: { month?: string } = {}) => request<Envelope<MyMonthResponse>>(`/hr/attendance/me${qs(params)}`),

  // What the caller may punch right now. Authoritative — the same rule the
  // check-in/check-out endpoints enforce, so the button never offers or refuses
  // something the server would then disagree with.
  todayState: () => request<Envelope<TodayPunchState>>('/hr/attendance/today-state'),

  team: (params: { date?: string } = {}) => request<Envelope<TeamDayRow[]>>(`/hr/attendance/team${qs(params)}`),

  photoUrl: (eventId: string) => `/api/hr/attendance/photos/${eventId}`,

  // Every punch of one employee's work date. The team view carries only the
  // day's first check-in and last check-out, so this is the only way to reach a
  // split shift's middle punches — and their selfies.
  /** The caller's own shift and its slots on a date (null when none). */
  myShift: (date: string) =>
    request<Envelope<{ shift_id: string; shift_name: string; start_time: string; end_time: string; is_split: boolean; segments: ShiftSegmentView[] } | null>>(`/hr/attendance/me/shift${qs({ date })}`),

  dayEvents: (params: { user_id: string; date: string }) =>
    request<Envelope<DayEventView[]>>(`/hr/attendance/events${qs(params)}`),

  // ── Face review queue (same approval authority as regularizations) ──
  faceReviews: {
    list: (params: { status?: 'pending' | 'cleared' | 'rejected'; page?: number; limit?: number } = {}) =>
      request<ListEnvelope<FaceReviewView>>(`/hr/attendance/face-reviews${qs(params)}`),

    // Confirms the punch. The day is recomputed and the withheld minutes are
    // restored, so this is not a cosmetic status change.
    clear: (eventId: string) =>
      request<Envelope<unknown>>(`/hr/attendance/face-reviews/${eventId}/clear`, { method: 'POST' }),

    // Invalidates the punch. The day is recomputed without it.
    reject: (eventId: string) =>
      request<Envelope<unknown>>(`/hr/attendance/face-reviews/${eventId}/reject`, { method: 'POST' }),
  },

  // ── Face enrollment (reference photo lives in identity as the avatar) ──
  face: {
    // Self-service enrollment context (own user): drives the check-in gate.
    me: () => request<Envelope<FaceSelfContext>>('/hr/attendance/face/me'),

    // Build the face template from the stored avatar. Self-enroll (own id) or
    // admin (any in-org). No image travels — enroll reads the avatar.
    enroll: (body: { user_id: string; consent: boolean }) =>
      request<Envelope<{ user_id: string; face_subject_id: string; face_enrolled_at: string }>>(
        '/hr/attendance/face/enroll',
        { method: 'POST', body: JSON.stringify(body) },
      ),

    // Stable, authenticated URL for a user's reference photo (avatar).
    referenceUrl: (userId: string) => `/api/users/${userId}/photo`,
  },

  regularizations: {
    create: (body: CreateRegularizationBody) =>
      request<Envelope<{ id: string }>>('/hr/attendance/regularizations', { method: 'POST', body: JSON.stringify(body) }),

    list: (params: ListRegularizationsParams = {}) =>
      request<ListEnvelope<RegularizationView>>(`/hr/attendance/regularizations${qs(params)}`),

    getById: (id: string) =>
      request<Envelope<RegularizationDetail>>(`/hr/attendance/regularizations/${id}`),

    approvals: (id: string) =>
      request<Envelope<RegularizationApprovalReview>>(`/hr/attendance/regularizations/${id}/approvals`),

    // Requester-side, own pending request only (server enforces both).
    update: (id: string, body: UpdateRegularizationBody) =>
      request<Envelope<{ id: string }>>(`/hr/attendance/regularizations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    cancel: (id: string) =>
      request<Envelope<{ id: string }>>(`/hr/attendance/regularizations/${id}/cancel`, { method: 'POST' }),

    approve: (id: string, comment?: string) =>
      request<Envelope<unknown>>(`/hr/attendance/regularizations/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }),

    reject: (id: string, comment: string) =>
      request<Envelope<unknown>>(`/hr/attendance/regularizations/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }),
  },

  reportsSummary: (params: { month?: string } = {}) =>
    request<Envelope<MonthlySummaryRow[]>>(`/hr/attendance/reports/summary${qs({ ...params, format: 'json' })}`),

  reportDownloadUrl: (params: { month?: string; format: 'csv' | 'xlsx' }) =>
    `/api/hr/attendance/reports/summary${qs(params)}`,

  // Detailed month report: xlsx = Summary / Daily Detail / Punches sheets,
  // csv = Daily Detail (one row per employee-day, sessions flattened).
  reportDetailDownloadUrl: (params: { month?: string; format: 'csv' | 'xlsx' }) =>
    `/api/hr/attendance/reports/detail${qs(params)}`,

  // Combined (muster) sheet: one row per employee, one P/A/HD/… cell per day.
  // branch=all is honoured only for holders of hr.reports.attendance.view.tenant.
  reportsMuster: (params: MusterParams) =>
    request<Envelope<MusterReport>>(`/hr/attendance/reports/muster${qs({ ...params, format: 'json' })}`),

  reportMusterDownloadUrl: (params: MusterParams) =>
    `/api/hr/attendance/reports/muster${qs({ ...params, format: 'xlsx' })}`,
};

// ── Shifts ───────────────────────────────────────────────────────────────────

export interface CreateShiftBody {
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  is_night_shift: boolean;
  is_split: boolean;
  // Required when is_split; the outer start_time/end_time is the window these
  // must nest inside, and they may not overlap each other.
  segments?: ShiftSegmentView[];
  // null = follow the attendance policy; 0 = no rest rule for this shift.
  min_rest_hours?: number | null;
}

export const shifts = {
  list: () => request<Envelope<ShiftView[]>>('/hr/shifts'),

  create: (body: CreateShiftBody) =>
    request<Envelope<{ id: string }>>('/hr/shifts', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<CreateShiftBody> & { is_active?: boolean }) =>
    request<void>(`/hr/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ── Shift assignments ───────────────────────────────────────────────────────

export interface CreateShiftAssignmentBody {
  user_id: string;
  shift_id: string;
  effective_from: string;
  effective_to?: string | null | undefined;
}

export const shiftAssignments = {
  list: (params: { userId?: string } = {}) =>
    request<Envelope<ShiftAssignmentView[]>>(`/hr/shift-assignments${qs(params)}`),

  create: (body: CreateShiftAssignmentBody) =>
    request<Envelope<{ id: string }>>('/hr/shift-assignments', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<CreateShiftAssignmentBody> & { is_active?: boolean }) =>
    request<void>(`/hr/shift-assignments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Re-resolve days that were already resolved — the nightly job only fills days
  // with no row yet, so this is what applies a newly-assigned shift to days the
  // employee has already punched. Omit user_id for the whole org.
  recompute: (body: { user_id?: string; from: string; to: string }) =>
    request<Envelope<{ employees_processed: number; days_processed: number; statuses: Record<string, number> }>>(
      '/hr/attendance/recompute',
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

// ── Geofence exceptions ─────────────────────────────────────────────────────
// The named people who may check in from outside the office radius.

export interface CreateGeoExceptionBody {
  user_id: string;
  exception_type: GeoExceptionType;
  effective_from: string;
  effective_to?: string | null | undefined;
  reason: string;
}

export const geoExceptions = {
  list: (params: { user_id?: string; exception_type?: GeoExceptionType; include_inactive?: boolean } = {}) =>
    request<Envelope<GeoExceptionView[]>>(`/hr/geo-exceptions${qs(params)}`),

  create: (body: CreateGeoExceptionBody) =>
    request<Envelope<{ id: string }>>('/hr/geo-exceptions', { method: 'POST', body: JSON.stringify(body) }),

  // exception_type is not updatable on purpose: changing the kind would rewrite
  // the stated reason for punches already made under it. End it and add another.
  update: (
    id: string,
    body: { effective_from?: string; effective_to?: string | null; reason?: string; is_active?: boolean },
  ) => request<void>(`/hr/geo-exceptions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
};
