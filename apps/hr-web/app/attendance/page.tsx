import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { AttendanceDashboardShell, getHrRank } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendancePage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  const hrRank = await getHrRank(result.cookieHeader);
  return <AttendanceDashboardShell actor={result.session} hrRank={hrRank} />;
}
