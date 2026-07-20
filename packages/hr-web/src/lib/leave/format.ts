// Pure leave-module helpers — no React, no I/O. Shared by the leave composites
// and the server pages (role gating).

import type { UserRole } from '@crm/auth-constants';
import type { HalfDay, LeaveStatusName } from './types';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Managers (rank ≥ 60), hr_admin and org_admin can see the approver queue. */
export function canViewLeaveApprovals(rank: number): boolean {
  return rank >= 60;
}

/** hr_admin (rank 75) or org_admin+ (rank ≥ 80) can manage leave configuration. */
export function canManageLeaveAdmin(role: UserRole, rank: number): boolean {
  return role === 'hr_admin' || rank >= 80;
}

/** A tenant_admin (rank ≥ 90) may additionally write tenant-wide policies/settings. */
export function canManageTenantLeave(rank: number): boolean {
  return rank >= 90;
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function halfSuffix(half: HalfDay): string {
  if (half === 'first_half') return ' (1st half)';
  if (half === 'second_half') return ' (2nd half)';
  return '';
}

/** "12 Aug 2026" for a single day, or "12 Aug – 15 Aug 2026" for a range, with
 * half-day markers on the endpoints. */
export function formatDateRange(
  start: string,
  end: string,
  startHalf: HalfDay = 'full',
  endHalf: HalfDay = 'full',
): string {
  if (start === end) {
    return `${formatDay(start)}${halfSuffix(startHalf)}`;
  }
  return `${formatDay(start)}${halfSuffix(startHalf)} – ${formatDay(end)}${halfSuffix(endHalf)}`;
}

/** "1.5 days" / "1 day" / "0.5 day". */
export function formatDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
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

// Status chip palette — matches the app's badge style (soft bg + strong fg).
export const LEAVE_STATUS_STYLES: Record<LeaveStatusName, { bg: string; fg: string }> = {
  draft: { bg: 'bg-slate-100', fg: 'text-slate-600' },
  pending: { bg: 'bg-amber-50', fg: 'text-amber-700' },
  approved: { bg: 'bg-green-50', fg: 'text-green-700' },
  rejected: { bg: 'bg-red-50', fg: 'text-red-700' },
  cancelled: { bg: 'bg-slate-100', fg: 'text-slate-500' },
  withdrawn: { bg: 'bg-slate-100', fg: 'text-slate-500' },
};

export const LEAVE_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** A request the owner can still cancel: pending, or a future-dated approved one. */
export function canCancelRequest(
  status: LeaveStatusName,
  startDate: string,
): boolean {
  if (status === 'pending') return true;
  if (status === 'approved') {
    const today = new Date().toISOString().slice(0, 10);
    return startDate > today;
  }
  return false;
}
