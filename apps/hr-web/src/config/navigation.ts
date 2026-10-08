import { CAPABILITY } from '@platform/rbac';
import type { NavItem } from '@platform/ui-kit/shell';

// HR product nav. Each entry names the TOOL it leads to — attendance and leave
// are separately licensed and separately granted, so a role can hold one and not
// the other. The role-gated sub-pages (Approvals, Admin) are reached from within
// each section and gate on their own nodes. Employees and Reports (1.56.0) were
// tabs of Leave admin and Attendance admin; each is now its own tool and page.
//
// Tier C3: previously `roles: ROLES`, i.e. visible to everyone with the module.
export const HR_NAV: readonly NavItem[] = [
  // Home opens for anyone holding attendance; a leave-only user still reaches it
  // via the brand link and the landing redirect (the page itself serves both).
  // Home composes attendance, leave and announcements: any one of them opens it (canOpenHrHome).
  { id: 'dashboard',  label: 'Home',       href: '/dashboard',  icon: 'layout-dashboard', capability: CAPABILITY.HR_ATTENDANCE_VIEW, exact: true, orCapabilities: [CAPABILITY.HR_LEAVE_VIEW, CAPABILITY.HR_EMPLOYEES_ANNOUNCEMENTS_VIEW] },
  // Operations (exact), like their page guards: canViewAttendance / canViewLeave.
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: 'clock', capability: CAPABILITY.HR_ATTENDANCE_VIEW, exact: true },
  // An OPERATION (exact), like My profile below.
  { id: 'team',       label: 'My team',    href: '/team',       icon: 'users-round', capability: CAPABILITY.HR_ATTENDANCE_ROSTER_VIEW, exact: true },
  // An OPERATION (exact): planning the roster is a different job from viewing it.
  { id: 'planner',    label: 'Roster planner', href: '/planner', icon: 'calendar-days', capability: CAPABILITY.HR_ATTENDANCE_ROSTER_MANAGE, exact: true },
  { id: 'leave',      label: 'Leave',      href: '/leave',      icon: 'plane', capability: CAPABILITY.HR_LEAVE_VIEW, exact: true },
  // Payslips: own-view OR payroll management opens it (the page guard asks the same pair).
  { id: 'payroll',    label: 'Payroll',    href: '/payroll',    icon: 'file-text', capability: CAPABILITY.HR_EMPLOYEES_PAYSLIP_VIEW, exact: true, orCapabilities: [CAPABILITY.HR_REPORTS_PAYROLL_MANAGE] },
  // Own documents (upload + status) OR HR review; the page guard asks the same pair.
  { id: 'documents',  label: 'Documents',  href: '/documents',  icon: 'folder-open', capability: CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW, exact: true, orCapabilities: [CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE] },
  // Operations (exact): the page guards are canViewEmployees / canViewAttendanceReports.
  { id: 'employees',  label: 'Employees',  href: '/employees',  icon: 'id-card', capability: CAPABILITY.HR_EMPLOYEES_VIEW, exact: true },
  { id: 'reports',    label: 'Reports',    href: '/reports',    icon: 'chart-column', capability: CAPABILITY.HR_REPORTS_ATTENDANCE_VIEW, exact: true },
  // An OPERATION, not a tool/page node, hence `exact`: holdsUsableNode() wants a granted descendant.
  { id: 'profile',    label: 'My profile', href: '/profile',    icon: 'users-round', capability: CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT, exact: true },
] as const;

// Phone bottom tab bar (AppShell `mobileTabs`): one entry per tab, each a list of
// nav item ids in preference order — the first one the actor may open wins, none
// drops the tab, and a trailing "More" opens the drawer. Ids only, so a tenant
// rename or an unlicensed tool needs no change here. Stitch's dock is
// Home / Attendance / Leaves / Payroll / Team; Payroll and Team join this
// list in the phases that build those pages (H5, H4) — a tab must never lead
// to a route that does not exist.
export const HR_MOBILE_TABS: readonly (readonly string[])[] = [
  ['dashboard'],
  ['attendance'],
  ['leave'],
  // Four tabs plus "More" is what fits a 390px phone (seven overflowed it). Payroll is the
  // Stitch dock's fourth tab; a person without payslips gets My team (or Employees) there instead.
  ['payroll', 'team', 'employees'],
];
