'use client';

import type { SessionUser } from '@platform/types';
import { PageTabs, type PageTab } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import { canViewTeamAttendance } from '@hr/authz';
import { canManageAttendanceAdmin } from '../../lib/attendance/format';

interface Props {
  // The caller's resolved rank on the unified iam ladder. See lib/hr-rank.ts.
  hrRank: HrRank;
  // Carries the DB-resolved capability list that decides which tabs exist.
  actor: SessionUser;
}

// In-page sub-navigation for the Attendance module. Renders inside PageHeader's
// band so the underline sits on the band's own edge-to-edge rule.
export default function AttendanceTabs({ hrRank, actor }: Props) {
  const tabs: PageTab[] = [
    { href: '/attendance', label: 'Dashboard', exact: true },
  ];
  // Tier C3: a tab exists when the DB grants the capability behind it — the same
  // list hr-service gates on. Previously unconditional, on the incorrect
  // assumption that the backend returns an empty view; it throws instead.
  if (canViewTeamAttendance(actor)) {
    tabs.push({ href: '/attendance/team', label: 'Team' });
  }
  if (canManageAttendanceAdmin(actor)) {
    tabs.push({ href: '/attendance/admin', label: 'Admin' });
  }

  return <PageTabs tabs={tabs} label="Attendance sections" />;
}
