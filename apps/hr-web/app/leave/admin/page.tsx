import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { adminWebOrigin } from '@platform/ui-kit/middleware';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageLeaveAdmin } from '@hr/web';

export const dynamic = 'force-dynamic';

// Leave admin moved to admin-web (Team/API Tokens/Leave/Attendance console for
// org_admin/tenant_admin). This route stays as a redirect for old bookmarks —
// the capability gate runs BEFORE redirecting so a denied user still sees
// denial here rather than an open redirect into admin-web.
export default async function LeaveAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  if (!canManageLeaveAdmin(result.session)) redirect('/leave');
  redirect(`${adminWebOrigin()}/dashboard/leave/admin`);
}
