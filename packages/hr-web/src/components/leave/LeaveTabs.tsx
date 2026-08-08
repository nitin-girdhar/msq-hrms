'use client';

import type { SessionUser } from '@platform/types';
import { PageTabs, type PageTab } from '@platform/ui-kit';
import { isOnHomeBranch } from '@hr/authz';
import type { HrRank } from '../../lib/hr-rank';
import { canApplyLeave, canDecideLeave } from '../../lib/leave/format';

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
  const tabs: PageTab[] = [];
  // Dashboard is the self-service screen (balances, my requests, apply leave)
  // — an actor without hr.leave.request.create (e.g. org_admin, tenant_admin,
  // hr_admin) has nothing to do there. Someone mapped to more than one branch
  // also loses it the moment they switch their active branch away from home:
  // they cannot apply from there (leave.repository.ts enforces this
  // server-side), so there is nothing left for the tab to do.
  if (canApplyLeave(actor) && isOnHomeBranch(actor)) {
    tabs.push({ href: '/leave', label: 'Dashboard', exact: true });
  }
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
