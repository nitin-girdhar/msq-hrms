import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canViewAttendanceReports } from '@hr/authz';
import { ReportsShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Same capability hr-service gates the report routes on, so the page never
  // renders for someone every call behind it would refuse.
  if (!canViewAttendanceReports(result.session)) redirect('/attendance');
  return <ReportsShell actor={result.session} />;
}
