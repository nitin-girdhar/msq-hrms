import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canViewTeamAttendance } from '@hr/authz';
import { AttendanceTeamShell, getHrRank } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendanceTeamPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Tier C3: gate on the SAME capability the service enforces — both read
  // session.capabilities / request.auth.capabilities, filled from one DB matrix.
  // The old "no gate, the backend scopes gracefully" assumption was wrong:
  // attendance.service.ts throws ForbiddenError, so under-privileged users got a
  // rendered page that then 403'd and leaked the raw error into a banner.
  if (!canViewTeamAttendance(result.session)) {
    redirect('/attendance');
  }
  const hrRank = await getHrRank(result.cookieHeader);
  return <AttendanceTeamShell actor={result.session} hrRank={hrRank} />;
}
