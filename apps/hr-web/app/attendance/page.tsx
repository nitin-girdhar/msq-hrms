import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { AttendanceDashboardShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendancePage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  return <AttendanceDashboardShell actor={result.session} />;
}
