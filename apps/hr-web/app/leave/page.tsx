import { notFound, redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canViewAttendance, canViewLeave, isOnHomeBranch } from '@hr/authz';
import { canApplyLeave, canDecideLeave, LeaveDashboardShell, getHrRank } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeavePage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.leave.view is what every read behind this page requires.
  if (!canViewLeave(result.session)) {
    if (canViewAttendance(result.session)) redirect('/attendance');
    notFound();
  }
  // Dashboard is the self-service screen (balances, my requests, apply leave)
  // — an actor without hr.leave.request.create (org_admin, tenant_admin,
  // hr_admin), or currently acting on a branch other than their home one,
  // has nothing to do here (leave.repository.ts refuses the apply itself),
  // so send them to the Approvals tab they do have instead. An actor with
  // neither capability (e.g. read_only) has no better place to go, so let
  // the page render.
  const canUseDashboard = canApplyLeave(result.session) && isOnHomeBranch(result.session);
  if (!canUseDashboard && canDecideLeave(result.session)) {
    redirect('/leave/approvals');
  }
  const hrRank = await getHrRank(result.cookieHeader);
  return <LeaveDashboardShell actor={result.session} hrRank={hrRank} />;
}
