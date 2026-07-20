import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageAttendanceAdmin, AttendanceAdminShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendanceAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr_admin / org_admin only — everyone else lands on the attendance dashboard.
  if (!canManageAttendanceAdmin(result.session.role, result.session.rank)) redirect('/attendance');
  return <AttendanceAdminShell actor={result.session} />;
}
