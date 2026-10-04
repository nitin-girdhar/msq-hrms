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
  { id: 'dashboard',  label: 'Home',       href: '/dashboard',  icon: 'layout-dashboard', capability: CAPABILITY.HR_ATTENDANCE },
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: 'clock', capability: CAPABILITY.HR_ATTENDANCE },
  { id: 'leave',      label: 'Leave',      href: '/leave',      icon: 'plane', capability: CAPABILITY.HR_LEAVE },
  { id: 'employees',  label: 'Employees',  href: '/employees',  icon: 'id-card', capability: CAPABILITY.HR_EMPLOYEES },
  { id: 'reports',    label: 'Reports',    href: '/reports',    icon: 'chart-column', capability: CAPABILITY.HR_REPORTS },
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
  ['employees'],
  ['reports'],
];
