import { CAPABILITY } from '@platform/rbac';
import type { NavItem } from '@platform/ui-kit/shell';

// HR product nav. Each entry names the TOOL it leads to — attendance and leave
// are separately licensed and separately granted, so a role can hold one and not
// the other. The role-gated sub-pages (Approvals, Admin) are reached from within
// each section and gate on their own nodes.
//
// Tier C3: previously `roles: ROLES`, i.e. visible to everyone with the module.
export const HR_NAV: readonly NavItem[] = [
  { id: 'attendance', label: 'Attendance', href: '/attendance', capability: CAPABILITY.HR_ATTENDANCE },
  { id: 'leave',      label: 'Leave',      href: '/leave',      capability: CAPABILITY.HR_LEAVE },
] as const;
