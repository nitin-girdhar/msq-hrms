import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { can, CAPABILITY } from '@platform/rbac';
import { DocumentsShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Either capability opens the page; each block renders only for the one it needs, and every
  // endpoint enforces its own.
  const ok = can(result.session, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW) || can(result.session, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE);
  if (!ok) redirect('/dashboard');
  return <DocumentsShell actor={result.session} />;
}
