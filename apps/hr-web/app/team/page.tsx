import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { can, CAPABILITY } from '@platform/rbac';
import { TeamRosterShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.attendance.roster.view is what GET /hr/attendance/roster requires.
  if (!can(result.session, CAPABILITY.HR_ATTENDANCE_ROSTER_VIEW)) redirect('/dashboard');
  return <TeamRosterShell actor={result.session} />;
}
