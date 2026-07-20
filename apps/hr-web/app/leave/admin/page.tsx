import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageLeaveAdmin, LeaveAdminShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeaveAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr_admin / org_admin only — everyone else lands on the leave dashboard.
  if (!canManageLeaveAdmin(result.session.role, result.session.rank)) redirect('/leave');
  return <LeaveAdminShell actor={result.session} />;
}
