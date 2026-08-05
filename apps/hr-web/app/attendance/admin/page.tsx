import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { adminWebOrigin } from '@platform/ui-kit/middleware';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageAttendanceAdmin } from '@hr/web';

export const dynamic = 'force-dynamic';

// Attendance admin moved to admin-web (Team/API Tokens/Leave/Attendance
// console for org_admin/tenant_admin). This route stays as a redirect for old
// bookmarks — the capability gate runs BEFORE redirecting so a denied user
// still sees denial here rather than an open redirect into admin-web.
export default async function AttendanceAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  if (!canManageAttendanceAdmin(result.session)) redirect('/attendance');
  redirect(`${adminWebOrigin()}/dashboard/attendance/admin`);
}
