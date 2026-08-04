// Pure attendance-module helpers — no React, no I/O. Shared by the attendance
// composites and the server pages (role gating). Mirrors apps/web/src/lib/leave/format.ts.

import type { ApiRequestError } from '@platform/ui-kit';
import { ANCHOR_RANK, can, CAPABILITY, type CapabilityHolder } from '@platform/rbac';
import type { AttendanceStatusName, RegularizationStatus } from './types';

/**
 * Who may manage attendance configuration.
 *
 * Tier C3: this asks the DB-resolved capability list on the session — the SAME
 * list hr-service gates on — instead of comparing a rank. That is what stops the
 * Admin tab from rendering for someone the service will refuse, and it means the
 * answer changes with a DB grant rather than a deploy.
 */
export function canManageAttendanceAdmin(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN);
}

/**
 * Who may act on a flagged face match. Mirrors the capability the clear/reject
 * routes require, so the queue is not rendered to someone the service will refuse
 * — and, like the helper above, asks the session's resolved capability list rather
 * than comparing a rank.
 */
export function canReviewFaceMatches(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_REGULARIZATION_APPROVE);
}

/** Only an org admin can set the org's geofence-centre coordinates — matches the
 *  floor identity-service's updateOrgGeo enforces, which excludes hr_admin. */
export function canSetOrgLocation(rank: number): boolean {
  return rank >= ANCHOR_RANK.ORG_ADMIN;
}

/**
 * A tenant admin may additionally write the TENANT-WIDE rules row — the default
 * every org without its own override inherits. Rank-based like
 * canManageTenantLeave, because this is a tenancy question rather than a
 * per-role permission; hr-service answers the same question with
 * isTenantHrAdmin(platform_role).
 */
export function canManageTenantAttendance(rank: number): boolean {
  return rank >= ANCHOR_RANK.TENANT_ADMIN;
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
  cancelled: { bg: 'bg-slate-100', fg: 'text-slate-600' },
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

// "Today" as a YYYY-MM-DD calendar date. When a timezone is given (the org's
// IANA zone from the attendance rules) the date is computed in THAT zone, to
// match the server, which keys attendance work_date on the org timezone. Without
// it, falls back to the browser's local date. Never use the raw UTC date here:
// during the UTC+ evening window the org-local day is already "tomorrow" vs UTC,
// which mismatched a just-recorded check-in's work_date and hid it.
export function todayIso(timezone?: string): string {
  if (!timezone) return new Date().toLocaleDateString('en-CA');
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

// Shift a YYYY-MM-DD calendar date by whole days, returning YYYY-MM-DD. Built on
// UTC so no zone shift can move the result across a day boundary — the input is
// already a calendar date, not an instant. Mirrors addDays in hr-service's
// lib/attendance/time.ts, so the bounds the picker shows are the ones the server
// computes when it validates the regularization window.
export function shiftIso(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
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
