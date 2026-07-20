// ── HR product rank scale (P1.3) ────────────────────────────────────────────
// Owned by @hr/authz; comparable only WITHIN HR. Mirrors hr.roles.rank in
// db_scripts/17_init-per-product-roles.sql:
//   hr_viewer 0 · hr_staff 40 · hr_manager 70 · hr_admin 80
// `role`/`rank` below are the HR PRODUCT role/rank (from hr.member_roles),
// resolved per request by hr-service. Tenant-wide authority is a PLATFORM
// concern keyed on platform_role — see isTenantLeaveAdmin.
export const HR_RANKS = {
  VIEWER: 0,
  STAFF: 40,
  MANAGER: 70,
  ADMIN: 80,
} as const;

/**
 * True when the acting user holds the HR admin product role. Retained as a
 * self-documenting predicate; note hr_admin now sits at the TOP of the HR scale
 * (rank 80), so `rank >= HR_RANKS.ADMIN` already implies it.
 */
export function isHrAdmin(role: string): boolean {
  return role === 'hr_admin';
}

/**
 * Whether the acting user may create/update employee profiles, departments,
 * and designations for their org: HR admin (rank >= 80).
 */
export function canManageEmployees(_role: string, rank: number): boolean {
  return rank >= HR_RANKS.ADMIN;
}

/**
 * Whether the acting user may manage leave configuration (policies, holidays,
 * settings, manual ledger adjustments) for their org: HR admin.
 */
export function canManageLeave(_role: string, rank: number): boolean {
  return rank >= HR_RANKS.ADMIN;
}

/**
 * Whether the acting user may act as an approval-override on any in-org leave
 * request (independent of being the resolved approver): HR admin.
 */
export function canOverrideLeaveApproval(_role: string, rank: number): boolean {
  return rank >= HR_RANKS.ADMIN;
}

/**
 * Whether the acting user may see a team/subtree leave queue at all:
 * HR manager+ (rank >= 70).
 */
export function canViewTeamLeave(_role: string, rank: number): boolean {
  return rank >= HR_RANKS.MANAGER;
}

/**
 * Tenant-wide leave policy/settings authority. This is a PLATFORM capability
 * (managing HR config across every org in the tenant), so it is keyed on
 * platform_role, not the HR product rank (which tops out per-org at hr_admin).
 */
export function isTenantLeaveAdmin(platformRole: string): boolean {
  return platformRole === 'tenant_admin' || platformRole === 'super_admin';
}

// ── Attendance ────────────────────────────────────────────────────────────────
// Attendance shares the same authority model as leave (HR admin for
// configuration; HR manager+ for team views). Dedicated names keep call sites
// self-documenting without duplicating the logic.

/**
 * Whether the acting user may manage attendance configuration — rules, shifts,
 * shift assignments — for their org: HR admin.
 */
export function canManageAttendance(_role: string, rank: number): boolean {
  return rank >= HR_RANKS.ADMIN;
}

/** Alias for shift/shift-assignment management (same authority as attendance config). */
export function canManageShifts(role: string, rank: number): boolean {
  return canManageAttendance(role, rank);
}

/**
 * Whether the acting user may see a team/subtree attendance view at all:
 * HR manager+ (rank >= 70).
 */
export function canViewTeamAttendance(_role: string, rank: number): boolean {
  return rank >= HR_RANKS.MANAGER;
}

/**
 * Whether the acting user may act as an approval-override on any in-org attendance
 * regularization (independent of being the resolved approver): HR admin.
 */
export function canOverrideAttendanceApproval(_role: string, rank: number): boolean {
  return rank >= HR_RANKS.ADMIN;
}
