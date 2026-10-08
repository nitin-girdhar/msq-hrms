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
import { can, resolveScope, CAPABILITY, ANCHOR_RANK, DEFAULT_ROLE_RANK, type CapabilityHolder } from '@platform/rbac';

/** Retained for the questions that are genuinely about SENIORITY, not access. */
export const HR_RANKS = {
  VIEWER:  ANCHOR_RANK.READ_ONLY,
  STAFF:   DEFAULT_ROLE_RANK.SENIOR_SALES_EXECUTIVE,
  MANAGER: DEFAULT_ROLE_RANK.ORG_MANAGER,
  ADMIN:   DEFAULT_ROLE_RANK.HR_ADMIN,
} as const;

/** The Attendance section at all — the self-service dashboard and every read behind it. */
export function canViewAttendance(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_VIEW);
}

/** The Leave section at all — balances, requests and the reads behind them. */
export function canViewLeave(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_VIEW);
}

/**
 * The HR Home page: it composes attendance, leave and announcements, so it opens
 * for a holder of any one of them (each block still renders only for its own grant).
 */
export function canOpenHrHome(actor: CapabilityHolder): boolean {
  return (
    can(actor, CAPABILITY.HR_ATTENDANCE_VIEW) ||
    can(actor, CAPABILITY.HR_LEAVE_VIEW) ||
    can(actor, CAPABILITY.HR_EMPLOYEES_ANNOUNCEMENTS_VIEW)
  );
}

/** Read employee profiles — gates the HRMS Employees page. */
export function canViewEmployees(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_EMPLOYEES_VIEW);
}

/** Create/update employee profiles, departments and designations. */
export function canManageEmployees(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_EMPLOYEES_MANAGE);
}

// ── Reports ─────────────────────────────────────────────────────────────────

/** Read attendance reports at all — gates the HRMS Reports page and its routes. */
export function canViewAttendanceReports(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_REPORTS_ATTENDANCE_VIEW);
}

export type ReportReach = 'org' | 'tenant';

/**
 * How far an attendance report may reach: 'tenant' may read every branch of the
 * tenant in one sheet ("All branches"), 'org' only the branch the session is in.
 * null means the operation is held with no scope, which reads nothing.
 *
 * Asked on both sides — the service decides which branches it reads from this,
 * and the Reports page decides whether to offer the all-branches view — so the
 * offer and the check behind it cannot disagree.
 */
export function attendanceReportReach(actor: CapabilityHolder): ReportReach | null {
  const scope = resolveScope(actor, CAPABILITY.HR_REPORTS_ATTENDANCE_VIEW);
  if (scope === 'tenant' || scope === 'all') return 'tenant';
  if (scope === 'org') return 'org';
  return null;
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
 * org's own override. A capability since 1.76.0 (it was a platform_role test):
 * a tenant that wants a regional HR head to own the defaults grants the key.
 *
 * Separate from canManageLeave / canManageAttendance on purpose: those say "may
 * configure THIS org"; these say "may reconfigure every sibling that inherits".
 * An org's own hr_admin holds the first and must not hold the second.
 */
export function canSetTenantLeaveDefaults(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_LEAVE_ADMIN_TENANT_WIDE);
}

export function canSetTenantAttendanceDefaults(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN_TENANT_WIDE);
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

/**
 * Exempt a named person from the geofence — a rotating field role, or an
 * approved work-from-home stretch. Deliberately its OWN capability rather than
 * riding on canManageAttendance: this is the authority to let someone's
 * attendance stop being location-verified, which an org may want to keep with
 * fewer people than the ones who set the radius.
 */
export function canManageGeoExceptions(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN_GEO_EXCEPTIONS_MANAGE);
}

/** See a team/subtree attendance view at all — this gates the Team tab. */
export function canViewTeamAttendance(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_VIEW_TEAM);
}

/**
 * Record your OWN attendance — this gates the self-service Dashboard tab
 * (check-in/out, my month, my regularizations), not just the punch button on
 * it. Admin roles (org_admin/tenant_admin/hr_admin) don't hold this: they
 * view and decide on other people's attendance, they don't clock in through
 * this role, so the tab itself has nothing left to show them.
 */
export function canPunchAttendance(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_PUNCH);
}

// A user carrying both the active and home org, e.g. `SessionUser`.
export interface BranchHolder {
  org_id: string;
  home_org_id: string;
}

/**
 * True when the caller's currently-active branch (org_id, set by
 * POST /switch-org) is their home branch (iam.users.org_id). A person mapped
 * to more than one branch can switch which one is active for their session;
 * they cannot mark attendance or apply for leave against a branch other than
 * their own — the punch/apply screens gate on this alongside
 * canPunchAttendance/canApplyLeave so the tab disappears the moment they
 * switch away from home, matching the server-side enforcement in
 * attendance.repository.ts / leave.repository.ts.
 */
export function isOnHomeBranch(actor: BranchHolder): boolean {
  return actor.org_id === actor.home_org_id;
}

/** Act as approval-override on any in-org attendance regularization. */
export function canOverrideAttendanceApproval(actor: CapabilityHolder): boolean {
  return can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN);
}
