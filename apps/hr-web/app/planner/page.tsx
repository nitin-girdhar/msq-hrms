import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { can, CAPABILITY } from '@platform/rbac';
import { PlannerShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function PlannerPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.attendance.roster.manage is what every /attendance/planner endpoint requires.
  if (!can(result.session, CAPABILITY.HR_ATTENDANCE_ROSTER_MANAGE)) redirect('/dashboard');
  return <PlannerShell actor={result.session} />;
}
