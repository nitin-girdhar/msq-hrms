import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canViewEmployees } from '@hr/authz';
import { OrgChartShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function OrgChartPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // hr.employees.view is what GET /hr/employees/org-chart requires.
  if (!canViewEmployees(result.session)) redirect('/dashboard');
  return <OrgChartShell actor={result.session} />;
}
