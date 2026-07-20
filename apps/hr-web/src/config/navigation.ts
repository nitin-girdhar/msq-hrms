import { ROLES } from '@platform/auth-constants';
import type { NavItem } from '@platform/ui-kit/shell';

// HR product nav. Attendance + Leave are available to every employee that has
// the module; the role-gated sub-pages (approvals/admin) are reached from
// within each section, not the top rail. Kept per-app (portable) rather than in
// ui-kit — the chrome is product-agnostic and takes these as props.
export const HR_NAV: readonly NavItem[] = [
  { id: 'attendance', label: 'Attendance', href: '/attendance', roles: ROLES },
  { id: 'leave', label: 'Leave', href: '/leave', roles: ROLES },
] as const;
