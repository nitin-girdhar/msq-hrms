// ── HR authority (Tier C3: capability-driven) ───────────────────────────────
// These predicates no longer compare ranks. They ask whether the actor holds a
// CAPABILITY, which is a row in iam.role_capabilities resolved per tenant — so
// "which roles may open the Team tab" becomes a DB change, not a deploy.
//
// The actor is anything carrying a resolved capability list: a service's
// `request.auth` (filled by the auth middleware) or a `SessionUser` from
// /auth/me. Both are filled from the SAME matrix, which is what stops a rendered
// tab and the call behind it from disagreeing.
//
// The rank ladder still exists and still matters — it answers "who is senior to
// whom" for manager-of resolution and approval chains. It just no longer answers
// "may this person do this".
import { can, CAPABILITY, ANCHOR_RANK, DEFAULT_ROLE_RANK, type CapabilityHolder } from '@platform/rbac';

/** Retained for the questions that are genuinely about SENIORITY, not access. */
export const HR_RANKS = {
  VIEWER:  ANCHOR_RANK.READ_ONLY,
  STAFF:   DEFAULT_ROLE_RANK.SENIOR_SALES_EXECUTIVE,
  MANAGER: DEFAULT_ROLE_RANK.ORG_MANAGER,
  ADMIN:   DEFAULT_ROLE_RANK.HR_ADMIN,
} as const;

/** True when the acting user holds the HR admin role by name. Kept for copy and
 *  logging; gate on capabilities, not on this. */
export function isHrAdmin(role: string): boolean {
  return role === 'hr_admin';
}

/** Create/update employee profiles, departments and designations. */
export function canManageEmployees(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_EMPLOYEES_MANAGE);
}

/** Leave configuration — policies, holidays, settings, manual ledger adjustments. */
export function canManageLeave(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_ADMIN);
}

/** Act as approval-override on any in-org leave request. */
export function canOverrideLeaveApproval(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_ADMIN);
}

/**
 * Authority to write TENANT-WIDE HR configuration — the rows other orgs inherit
 * (hr.hr_settings and hr.attendance_rules with org_id NULL), as opposed to an
 * org's own override. Still keyed on platform_role: this is a TENANCY question
 * ("may you act across every org"), not a per-role permission, so it is answered
 * by the JWT rather than the capability matrix.
 *
 * The capability check is separate and still required — this only decides SCOPE.
 * An hr_admin holds hr.leave.admin / hr.attendance.admin and configures their own
 * org; only a tenant admin can change the default every other org inherits.
 */
export function isTenantHrAdmin(platformRole: string): boolean {
  return platformRole === 'tenant_admin' || platformRole === 'super_admin';
}

/** @see isTenantHrAdmin — the leave-side name, kept for its existing callers. */
export function isTenantLeaveAdmin(platformRole: string): boolean {
  return isTenantHrAdmin(platformRole);
}

// ── Attendance ──────────────────────────────────────────────────────────────

/** Attendance configuration — rules, shifts, shift assignments. */
export function canManageAttendance(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN);
}

/** Shift and shift-assignment management (same authority as attendance config). */
export function canManageShifts(actor: CapabilityHolder): boolean {
  return canManageAttendance(actor);
}

/** See a team/subtree attendance view at all — this gates the Team tab. */
export function canViewTeamAttendance(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_VIEW_TEAM);
}

/** Act as approval-override on any in-org attendance regularization. */
export function canOverrideAttendanceApproval(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN);
}
