'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader } from '@platform/ui-kit';
import { canManageEmployees } from '@hr/authz';
import { can, CAPABILITY } from '@platform/rbac';
import EmployeeProfilesManager from './EmployeeProfilesManager';

interface Props {
  actor: SessionUser;
}

// The HRMS "Employees" left-nav page. Until 1.56.0 this list was the Employees
// tab of Leave administration; it is shared by leave AND attendance, so it lives
// on its own page under the hr.employees tool.
export default function EmployeesShell({ actor }: Props) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Employees"
        subtitle="Joining date, department, designation and weekly-off pattern used by leave and attendance."
      />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        <EmployeeProfilesManager onNotice={setNotice} canManage={canManageEmployees(actor)} canOpenProfile={can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW)} />
      </PageBody>
    </div>
  );
}
