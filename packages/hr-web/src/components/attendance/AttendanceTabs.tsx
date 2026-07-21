'use client';

import { PageTabs, type PageTab } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import { canManageAttendanceAdmin } from '../../lib/attendance/format';

interface Props {
  // The caller's resolved HR product rank (hr.member_roles) — never
  // SessionUser.rank, which is the platform/session rank. See lib/hr-rank.ts.
  hrRank: HrRank;
}

// In-page sub-navigation for the Attendance module. Renders inside PageHeader's
// band so the underline sits on the band's own edge-to-edge rule.
export default function AttendanceTabs({ hrRank }: Props) {
  const tabs: PageTab[] = [
    { href: '/attendance', label: 'Dashboard', exact: true },
    // Always shown: the backend's getTeam/listRegularizations queries already
    // scope results to the acting user's own reports or (with HR manager+/
    // admin rank) the full org — see attendance.service.ts. A user with
    // neither just sees an empty team view, same as any other empty state.
    { href: '/attendance/team', label: 'Team' },
  ];
  if (canManageAttendanceAdmin(hrRank.rank)) {
    tabs.push({ href: '/attendance/admin', label: 'Admin' });
  }

  return <PageTabs tabs={tabs} label="Attendance sections" />;
}
