import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canViewAttendanceTeam, AttendanceTeamShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendanceTeamPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Same rank/role gating the CRM UI uses — under-privileged users are sent to
  // the attendance dashboard rather than shown a 404 (matches app/leave/approvals).
  if (!canViewAttendanceTeam(result.session.rank)) redirect('/attendance');
  return <AttendanceTeamShell actor={result.session} />;
}
