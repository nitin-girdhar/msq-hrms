'use client';

import { PageTabs, type PageTab } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import { canManageLeaveAdmin } from '../../lib/leave/format';

interface Props {
  // The caller's resolved HR product rank (hr.member_roles) — never
  // SessionUser.rank, which is the platform/session rank. See lib/hr-rank.ts.
  hrRank: HrRank;
}

// In-page sub-navigation for the Leave module. The shared AppSidebar chrome
// (rendered by HrModuleShell) stays untouched; visibility of each tab mirrors
// the same rank/role gating the CRM UI uses (see src/config/navigation.ts).
export default function LeaveTabs({ hrRank }: Props) {
  const tabs: PageTab[] = [
    { href: '/leave', label: 'Dashboard', exact: true },
    // Always shown: visibility of pending items is enforced by the backend's
    // own query scoping (you only ever see requests you're the resolved
    // approver for, your direct reports, or — with HR manager+/admin rank —
    // the full org queue), not by a platform-rank gate here. See
    // hr-service's leave.service.ts#listTeamRequests.
    { href: '/leave/approvals', label: 'Approvals' },
  ];
  if (canManageLeaveAdmin(hrRank.rank)) {
    tabs.push({ href: '/leave/admin', label: 'Admin' });
  }

  return <PageTabs tabs={tabs} label="Leave sections" />;
}
