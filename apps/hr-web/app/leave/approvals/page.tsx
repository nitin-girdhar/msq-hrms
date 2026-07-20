import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { getHrRank, LeaveApprovalsShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeaveApprovalsPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // No rank gate: the backend's listTeamRequests query already scopes results
  // to the acting user's own resolved-approver items, direct reports, or (with
  // HR manager+/admin rank) the full org queue — see leave.service.ts. A user
  // with neither just sees an empty pending list, same as any other empty state.
  const hrRank = await getHrRank(result.cookieHeader);
  return <LeaveApprovalsShell actor={result.session} hrRank={hrRank} />;
}
