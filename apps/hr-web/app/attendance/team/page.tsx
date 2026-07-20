import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { AttendanceTeamShell, getHrRank } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendanceTeamPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // No rank gate: the backend's getTeam/listRegularizations queries already
  // scope results to the acting user's own reports or (with HR manager+/admin
  // rank) the full org — see attendance.service.ts. A user with neither just
  // sees an empty team view, same as any other empty state.
  const hrRank = await getHrRank(result.cookieHeader);
  return <AttendanceTeamShell actor={result.session} hrRank={hrRank} />;
}
