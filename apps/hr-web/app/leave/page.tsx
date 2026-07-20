import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { LeaveDashboardShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeavePage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  return <LeaveDashboardShell actor={result.session} />;
}
