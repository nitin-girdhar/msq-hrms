import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { EmployeeDashboardShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // No capability redirect here: the shell renders only the blocks the actor's
  // capabilities allow, and every endpoint behind them enforces its own gate.
  return <EmployeeDashboardShell actor={result.session} />;
}
