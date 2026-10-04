import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { can, CAPABILITY } from '@platform/rbac';
import { PayrollShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function PayrollPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Either capability opens the page; each block inside renders only for the one it needs,
  // and every endpoint enforces its own.
  const ok = can(result.session, CAPABILITY.HR_EMPLOYEES_PAYSLIP_VIEW) || can(result.session, CAPABILITY.HR_REPORTS_PAYROLL_MANAGE);
  if (!ok) redirect('/dashboard');
  return <PayrollShell actor={result.session} />;
}
