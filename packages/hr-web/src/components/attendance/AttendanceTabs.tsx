'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { HrRank } from '../../lib/hr-rank';
import { canManageAttendanceAdmin } from '../../lib/attendance/format';

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

// In-page sub-navigation for the Attendance module. Mirrors apps/web/components/leave/LeaveTabs.tsx.
export default function AttendanceTabs({ hrRank }: Props) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { href: '/attendance', label: 'Dashboard', show: true },
    // Always shown: the backend's getTeam/listRegularizations queries already
    // scope results to the acting user's own reports or (with HR manager+/
    // admin rank) the full org — see attendance.service.ts. A user with
    // neither just sees an empty team view, same as any other empty state.
    { href: '/attendance/team', label: 'Team', show: true },
    { href: '/attendance/admin', label: 'Admin', show: canManageAttendanceAdmin(hrRank.rank) },
  ];

  return (
    <nav className="flex gap-1 border-b border-[#E2E8F0]" aria-label="Attendance sections">
      {tabs
        .filter((t) => t.show)
        .map((tab) => {
          const active =
            tab.href === '/attendance'
              ? pathname === '/attendance'
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
