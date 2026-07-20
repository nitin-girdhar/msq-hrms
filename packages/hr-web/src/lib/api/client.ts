// HR / platform-module API namespace. Built on the same generic fetch wrapper
// (@platform/ui-kit `createApiClient`) as the CRM `client.ts`, but kept in a separate file
// because it is HR domain knowledge (leave, holidays, employees). Paths are the
// gateway prefixes — Next.js rewrites `/api/:path*` → gateway `/:path*`
// (apps/web/next.config.ts), so `/hr/leave/*` reaches hr-service via the gateway.

import { createApiClient } from '@platform/ui-kit';
import type {
  LeaveBalance,
  LeaveRequestView,
  LeavePreview,
  LeavePolicyView,
  HolidayView,
  HolidayCalendarView,
  LeaveSettings,
  HalfDay,
  EmployeeProfileView,
  HrLookupOption,
} from '../leave/types';
import type {
  AttendanceRules,
  PunchResult,
  MyMonthResponse,
  TeamDayRow,
  ShiftView,
  ShiftAssignmentView,
  RegularizationView,
  MonthlySummaryRow,
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
  balances: () => request<Envelope<LeaveBalance[]>>('/hr/leave/balances'),

  balancesForUser: (userId: string) =>
    request<Envelope<LeaveBalance[]>>(`/hr/leave/balances/${userId}`),

  myRequests: (params: ListRequestsParams = {}) =>
    request<ListEnvelope<LeaveRequestView>>(`/hr/leave/requests${qs(params)}`),

  teamRequests: (params: ListRequestsParams = {}) =>
    request<ListEnvelope<LeaveRequestView>>(`/hr/leave/requests/team${qs(params)}`),

  preview: (params: PreviewParams) =>
    request<Envelope<LeavePreview>>(`/hr/leave/requests/preview${qs(params)}`),

  apply: (body: ApplyLeaveBody) =>
    request<Envelope<{ id: string; days_count: number; level1_approver_id: string | null }>>(
      '/hr/leave/requests',
      { method: 'POST', body: JSON.stringify(body) },
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

  cancel: (id: string, comment?: string) =>
    request<Envelope<{ reversed: boolean }>>(`/hr/leave/requests/${id}/cancel`, {
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

export const hrEmployees = {
  list: () => request<Envelope<EmployeeProfileView[]>>('/hr/employees'),

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

  updateRules: (body: Partial<AttendanceRules>) =>
    request<Envelope<AttendanceRules>>('/hr/attendance/rules/admin', { method: 'PUT', body: JSON.stringify(body) }),

  me: (params: { month?: string } = {}) => request<Envelope<MyMonthResponse>>(`/hr/attendance/me${qs(params)}`),

  team: (params: { date?: string } = {}) => request<Envelope<TeamDayRow[]>>(`/hr/attendance/team${qs(params)}`),

  photoUrl: (eventId: string) => `/api/hr/attendance/photos/${eventId}`,

  regularizations: {
    create: (body: CreateRegularizationBody) =>
      request<Envelope<{ id: string }>>('/hr/attendance/regularizations', { method: 'POST', body: JSON.stringify(body) }),

    list: (params: ListRegularizationsParams = {}) =>
      request<ListEnvelope<RegularizationView>>(`/hr/attendance/regularizations${qs(params)}`),

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
};
