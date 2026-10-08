// Pure leave-module helpers — no React, no I/O. Shared by the leave composites
// and the server pages (role gating).

import { ANCHOR_RANK, can, CAPABILITY, type CapabilityHolder } from '@platform/rbac';
import type { HalfDay, LeaveStatusName } from './types';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Who may manage leave configuration.
 *
 * Tier C3: DB-resolved capability, not a rank comparison — the same list
 * hr-service gates on, so the Admin tab and the calls behind it agree.
 */
export function canManageLeaveAdmin(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_ADMIN);
}

/**
 * Who may act on someone else's leave request — i.e. who the Approvals tab is
 * for at all.
 *
 * Approving and rejecting are one grant (hr.leave.approve since 1.76.0). Someone
 * without it can do nothing on that page — the queue is empty by construction and every action is
 * refused — so the tab is hidden rather than shown as a dead end.
 */
export function canDecideLeave(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_APPROVE);
}

/**
 * Apply for / edit your OWN leave — this gates the self-service Dashboard tab
 * (balances, my requests, apply leave), not just the Apply button on it.
 * Admin roles (org_admin/tenant_admin/hr_admin) don't hold this: they decide
 * on other people's leave, they don't file their own requests through this
 * role, so the tab itself has nothing left to show them.
 */
export function canApplyLeave(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_REQUEST_CREATE);
}

/** Writing the tenant-wide policies/settings is its own grant (hr.leave.admin.tenant_wide). */
export function canManageTenantLeave(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_ADMIN_TENANT_WIDE);
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
  draft: { bg: 'bg-surface-container', fg: 'text-on-surface-variant' },
  pending: { bg: 'bg-status-due-container', fg: 'text-on-status-due-container' },
  approved: { bg: 'bg-status-success-container', fg: 'text-on-status-success-container' },
  rejected: { bg: 'bg-status-overdue-container', fg: 'text-on-status-overdue-container' },
  cancelled: { bg: 'bg-surface-container', fg: 'text-on-surface-variant' },
  withdrawn: { bg: 'bg-surface-container', fg: 'text-on-surface-variant' },
};

// Seeded default leave type names (hr.leave_types) with display labels — the
// field still accepts any active type name (server validates against the
// tenant's lookup), this just gives the seeded set a readable dropdown instead
// of raw snake_case keys.
export const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: 'Casual',
  sick: 'Sick',
  earned: 'Earned',
  maternity: 'Maternity',
  paternity: 'Paternity',
  bereavement: 'Bereavement',
  comp_off: 'Comp Off',
  loss_of_pay: 'Loss of Pay',
};

export const ACCRUAL_FREQUENCY_LABELS: Record<string, string> = {
  none: 'None',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export const LEAVE_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** A request the owner can still cancel: pending, or a future-dated approved one. */
/**
 * Only a still-pending request can be amended. Once a decision exists the
 * request is the record of what was decided — mirrors the server, which refuses
 * an edit in any other state.
 */
export function canEditRequest(status: LeaveStatusName): boolean {
  return status === 'pending';
}

// Pending only — once an approver has acted, the balance ledger and the
// 'on_leave' attendance days are already written and only HR can reverse them.
// hr-service enforces the same rule (leave.repository.cancelLeave); this just
// keeps the button off a row the server would reject.
export function canCancelRequest(status: LeaveStatusName): boolean {
  return status === 'pending';
}
