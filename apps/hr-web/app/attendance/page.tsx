import { notFound, redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canPunchAttendance, canViewAttendance, canViewLeave, canViewTeamAttendance, isOnHomeBranch } from '@hr/authz';
import { AttendanceDashboardShell, getHrRank } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendancePage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.attendance.view is what every read behind this page requires. Without it the
  // page would render and then 403 on each call, so send the actor to the other HR
  // section they hold, or 404 when they hold neither.
  if (!canViewAttendance(result.session)) {
    if (canViewLeave(result.session)) redirect('/leave');
    notFound();
  }
  // Dashboard is the self-service screen (check-in/out, my month, my
  // regularizations) — an actor without hr.attendance.punch (org_admin,
  // tenant_admin, hr_admin), or currently acting on a branch other than their
  // home one, has nothing to do here (attendance.repository.ts refuses the
  // punch itself), so send them to the Team tab they do have instead. An
  // actor with neither capability (e.g. read_only) has no better place to
  // go, so let the page render.
  const canUseDashboard = canPunchAttendance(result.session) && isOnHomeBranch(result.session);
  if (!canUseDashboard && canViewTeamAttendance(result.session)) {
    redirect('/attendance/team');
  }
  const hrRank = await getHrRank(result.cookieHeader);
  return <AttendanceDashboardShell actor={result.session} hrRank={hrRank} />;
}
