import { notFound, redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canOpenHrHome } from '@hr/authz';
import { EmployeeDashboardShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Home opens for a holder of attendance, leave or announcements; each block then
  // renders only for its own grant, and every endpoint behind it enforces its own gate.
  if (!canOpenHrHome(result.session)) notFound();
  return <EmployeeDashboardShell actor={result.session} />;
}
