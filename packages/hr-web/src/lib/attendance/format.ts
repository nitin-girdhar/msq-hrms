// Pure attendance-module helpers — no React, no I/O. Shared by the attendance
// composites and the server pages (role gating). Mirrors apps/web/src/lib/leave/format.ts.

import type { ApiRequestError } from '@platform/ui-kit';
import type { AttendanceStatusName, RegularizationStatus } from './types';

/**
 * HR admin (rank ≥ 80) can manage attendance configuration. `rank` must be
 * the caller's resolved HR product rank (hr.member_roles, via getHrRank/GET
 * /hr/me) — never SessionUser.rank, which is the platform/session rank, a
 * different scale that only coincidentally overlaps for org/tenant admins.
 */
export function canManageAttendanceAdmin(rank: number): boolean {
  return rank >= 80;
}

/** Only an org admin (rank ≥ 80) can set the org's geofence-centre coordinates
 * (identity-service's updateOrgGeo hard-codes rank >= 80, excluding hr_admin). */
export function canSetOrgLocation(rank: number): boolean {
  return rank >= 80;
}

export const ATTENDANCE_STATUS_STYLES: Record<AttendanceStatusName, { bg: string; fg: string; dot: string }> = {
  present: { bg: 'bg-green-50', fg: 'text-green-700', dot: '#16A34A' },
  absent: { bg: 'bg-red-50', fg: 'text-red-700', dot: '#DC2626' },
  half_day: { bg: 'bg-amber-50', fg: 'text-amber-700', dot: '#D97706' },
  on_leave: { bg: 'bg-blue-50', fg: 'text-[#0b6cbf]', dot: '#0b6cbf' },
  holiday: { bg: 'bg-purple-50', fg: 'text-purple-700', dot: '#7C3AED' },
  weekly_off: { bg: 'bg-slate-100', fg: 'text-slate-500', dot: '#94A3B8' },
  wfh: { bg: 'bg-cyan-50', fg: 'text-cyan-700', dot: '#0891B2' },
  not_marked: { bg: 'bg-slate-100', fg: 'text-slate-400', dot: '#CBD5E1' },
};

export const REGULARIZATION_STATUS_STYLES: Record<RegularizationStatus, { bg: string; fg: string }> = {
  pending: { bg: 'bg-amber-50', fg: 'text-amber-700' },
  approved: { bg: 'bg-green-50', fg: 'text-green-700' },
  rejected: { bg: 'bg-red-50', fg: 'text-red-700' },
};

export function formatWorkedMinutes(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatClockTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PunchErrorDetails {
  code?: string;
  distance_m?: number;
  allowed_radius_m?: number;
}
interface PunchErrorBody {
  error?: string;
  details?: PunchErrorDetails;
}

/** Turns a thrown ApiRequestError from a check-in/out call into the plain-language
 * copy the spec calls for. createApiClient's Error.message drops numeric fields
 * from `details` (it only joins string values), so this reads `err.body` directly. */
export function describePunchError(err: unknown): string {
  const apiErr = err as Partial<ApiRequestError> & { body?: PunchErrorBody };
  const details = apiErr?.body?.details;
  const code = details?.code;

  switch (code) {
    case 'GEO_REQUIRED':
      return 'Location is required to check in.';
    case 'ORG_LOCATION_NOT_SET':
      return "Your organization's location hasn't been set up yet. Ask an org admin to set it under Attendance → Admin → Rules before you can check in.";
    case 'OUTSIDE_GEOFENCE': {
      const distance = details?.distance_m;
      const radius = details?.allowed_radius_m;
      if (distance != null && radius != null) {
        return `You are ${Math.round(distance)}m from the office; check-in is allowed within ${radius}m.`;
      }
      return "You're outside the allowed check-in radius.";
    }
    case 'PHOTO_REQUIRED':
      return 'A photo is required to check in.';
    case 'PHOTO_TOO_LARGE':
      return 'The photo is too large. Please retake it.';
    default:
      return err instanceof Error && err.message ? err.message : 'Failed to record attendance.';
  }
}
