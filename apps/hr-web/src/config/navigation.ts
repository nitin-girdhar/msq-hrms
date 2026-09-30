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
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: 'clock', capability: CAPABILITY.HR_ATTENDANCE },
  { id: 'leave',      label: 'Leave',      href: '/leave',      icon: 'plane', capability: CAPABILITY.HR_LEAVE },
  { id: 'employees',  label: 'Employees',  href: '/employees',  icon: 'id-card', capability: CAPABILITY.HR_EMPLOYEES },
  { id: 'reports',    label: 'Reports',    href: '/reports',    icon: 'chart-column', capability: CAPABILITY.HR_REPORTS },
] as const;
