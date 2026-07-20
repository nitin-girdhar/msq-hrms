import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageLeaveAdmin, getHrRank, LeaveAdminShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeaveAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // HR admin only (hr.member_roles rank >= 80) — everyone else lands on the
  // leave dashboard. Gated on the resolved HR product rank, never
  // result.session.rank (the platform/session rank — a different scale).
  const hrRank = await getHrRank(result.cookieHeader);
  if (!canManageLeaveAdmin(hrRank.rank)) redirect('/leave');
  return <LeaveAdminShell actor={result.session} hrRank={hrRank} />;
}
