import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { can, CAPABILITY } from '@platform/rbac';
import { Employee360Shell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function EmployeeProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.employees.profile360.view is what GET /hr/employees/:userId/profile-360 requires.
  if (!can(result.session, CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW)) redirect('/employees');
  const { userId } = await params;
  return <Employee360Shell actor={result.session} userId={userId} />;
}
