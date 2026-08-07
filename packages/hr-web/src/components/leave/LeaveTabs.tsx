'use client';

import type { SessionUser } from '@platform/types';
import { PageTabs, type PageTab } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import { canDecideLeave } from '../../lib/leave/format';

interface Props {
  // The caller's resolved rank on the unified iam ladder. See lib/hr-rank.ts.
  hrRank: HrRank;
  // Carries the DB-resolved capability list that decides which tabs exist.
  actor: SessionUser;
}

// In-page sub-navigation for the Leave module. The shared AppSidebar chrome
// (rendered by HrModuleShell) stays untouched; visibility of each tab mirrors
// the same rank/role gating the CRM UI uses (see src/config/navigation.ts).
export default function LeaveTabs({ hrRank, actor }: Props) {
  const tabs: PageTab[] = [{ href: '/leave', label: 'Dashboard', exact: true }];
  // WHICH pending items an approver sees is the backend's business — its query
  // scopes to the requests you are the resolved approver for, your direct
  // reports, or (with HR manager+/admin rank) the whole org. WHETHER the tab
  // exists is a capability question: without approve or reject there is nothing
  // to decide, and the page renders an always-empty queue over a team calendar
  // that 403s.
  if (canDecideLeave(actor)) {
    tabs.push({ href: '/leave/approvals', label: 'Approvals' });
  }

  return <PageTabs tabs={tabs} label="Leave sections" />;
}
