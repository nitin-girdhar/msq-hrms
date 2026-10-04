import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { can, CAPABILITY } from '@platform/rbac';
import { MyProfileShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.employees.profile.edit is what GET /hr/profile/me requires.
  if (!can(result.session, CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT)) redirect('/dashboard');
  return <MyProfileShell actor={result.session} />;
}
