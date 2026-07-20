'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { HrRank } from '../../lib/hr-rank';
import { canManageLeaveAdmin } from '../../lib/leave/format';

interface Props {
  // The caller's resolved HR product rank (hr.member_roles) — never
  // SessionUser.rank, which is the platform/session rank. See lib/hr-rank.ts.
  hrRank: HrRank;
}

interface Tab {
  href: string;
  label: string;
  show: boolean;
}

// In-page sub-navigation for the Leave module. The shared DashboardSidebar chrome
// (rendered by ModuleShell) stays untouched; visibility of each tab mirrors the
// same rank/role gating the CRM UI uses (see src/config/navigation.ts).
export default function LeaveTabs({ hrRank }: Props) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { href: '/leave', label: 'Dashboard', show: true },
    // Always shown: visibility of pending items is enforced by the backend's
    // own query scoping (you only ever see requests you're the resolved
    // approver for, your direct reports, or — with HR manager+/admin rank —
    // the full org queue), not by a platform-rank gate here. See
    // hr-service's leave.service.ts#listTeamRequests.
    { href: '/leave/approvals', label: 'Approvals', show: true },
    { href: '/leave/admin', label: 'Admin', show: canManageLeaveAdmin(hrRank.rank) },
  ];

  return (
    <nav className="flex gap-1 border-b border-[#E2E8F0]" aria-label="Leave sections">
      {tabs
        .filter((t) => t.show)
        .map((tab) => {
          const active =
            tab.href === '/leave'
              ? pathname === '/leave'
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? '-mb-px border-b-2 border-[#0b6cbf] px-4 py-2.5 text-sm font-semibold text-[#0b6cbf]'
                  : '-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-[#64748B] transition-colors hover:text-[#0F172A]'
              }
            >
              {tab.label}
            </Link>
          );
        })}
    </nav>
  );
}
