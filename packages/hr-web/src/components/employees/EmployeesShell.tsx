'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader } from '@platform/ui-kit';
import { canManageEmployees } from '@hr/authz';
import { can, CAPABILITY } from '@platform/rbac';
import Link from 'next/link';
import { PageSection } from '@platform/ui-kit';
import { ChangeRequestQueue } from '../profile/StatutoryPanel';
import EmployeeProfilesManager from './EmployeeProfilesManager';

interface Props {
  actor: SessionUser;
}

// The HRMS "Employees" left-nav page. Until 1.56.0 this list was the Employees
// tab of Leave administration; it is shared by leave AND attendance, so it lives
// on its own page under the hr.employees tool.
export default function EmployeesShell({ actor }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Employees"
        subtitle="Joining date, department, designation and weekly-off pattern used by leave and attendance."
        actions={<Link href="/org-chart" className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant shadow-sm hover:border-primary hover:text-primary">Org chart</Link>}
      />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <EmployeeProfilesManager onNotice={setNotice} canManage={canManageEmployees(actor)} canOpenProfile={can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW)} />
        {can(actor, CAPABILITY.HR_EMPLOYEES_STATUTORY_MANAGE) && (
          <PageSection title="Change requests from employees">
            <ChangeRequestQueue onNotice={setNotice} onError={setError} />
          </PageSection>
        )}
      </PageBody>
    </div>
  );
}
