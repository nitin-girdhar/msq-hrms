import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canViewLeaveApprovals, LeaveApprovalsShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeaveApprovalsPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Same rank/role gating the CRM UI uses — under-privileged users are sent to
  // the leave dashboard rather than shown a 404 (matches app/dashboard/team).
  if (!canViewLeaveApprovals(result.session.rank)) redirect('/leave');
  return <LeaveApprovalsShell actor={result.session} />;
}
