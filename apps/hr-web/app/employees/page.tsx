import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { adminWebOrigin } from '@platform/ui-kit/middleware';
import { getServerSession } from '@platform/ui-kit/server';
import { canViewEmployees } from '@hr/authz';
import { EmployeesShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.employees.view is what GET /hr/employees requires.
  if (!canViewEmployees(result.session)) redirect('/attendance');
  const adminOrigin = adminWebOrigin();
  return <EmployeesShell actor={result.session} {...(adminOrigin ? { teamUrl: `${adminOrigin}/dashboard/team` } : {})} />;
}
