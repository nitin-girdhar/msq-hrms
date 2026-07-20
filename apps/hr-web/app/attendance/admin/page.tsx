import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageAttendanceAdmin, AttendanceAdminShell, getHrRank } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendanceAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // HR admin only (hr.member_roles rank >= 80) — everyone else lands on the
  // attendance dashboard. Gated on the resolved HR product rank, never
  // result.session.rank (the platform/session rank — a different scale).
  const hrRank = await getHrRank(result.cookieHeader);
  if (!canManageAttendanceAdmin(hrRank.rank)) redirect('/attendance');
  return <AttendanceAdminShell actor={result.session} hrRank={hrRank} />;
}
