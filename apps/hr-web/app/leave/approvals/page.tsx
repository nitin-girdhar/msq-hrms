import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canDecideLeave, getHrRank, LeaveApprovalsShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeaveApprovalsPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Tier C3: gated on the hr.leave.approve / hr.leave.reject capabilities — the
  // same grants hr-service checks — so the tab and the page agree, and typing
  // the URL cannot reach a screen where every action would be refused.
  //
  // Still no RANK gate: WHICH requests an approver sees stays the backend's
  // call, scoped by listTeamRequests to their resolved-approver items, direct
  // reports, or (HR manager+/admin) the full org queue.
  if (!canDecideLeave(result.session)) redirect('/leave');
  const hrRank = await getHrRank(result.cookieHeader);
  return <LeaveApprovalsShell actor={result.session} hrRank={hrRank} />;
}
