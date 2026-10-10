'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader } from '@platform/ui-kit';
import { can, CAPABILITY } from '@platform/rbac';
import Link from 'next/link';
import { PageSection } from '@platform/ui-kit';
import { ChangeRequestQueue } from '../profile/StatutoryPanel';
import EmployeeProfilesManager from './EmployeeProfilesManager';

interface Props {
  actor: SessionUser;
  /** admin-web's Team page (where employees are edited); omitted when no admin origin is configured. */
  teamUrl?: string;
}

// The HRMS "Employees" left-nav page. Until 1.56.0 this list was the Employees
// tab of Leave administration; it is shared by leave AND attendance, so it lives
// on its own page under the hr.employees tool.
export default function EmployeesShell({ actor, teamUrl }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Employees"
        info="Read-only directory. Employee details are edited in Admin → Team so the account and the HR profile never disagree."
        actions={<Link href="/org-chart" className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant shadow-sm hover:border-primary hover:text-primary">Org chart</Link>}
      />
      <PageBody dense>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <EmployeeProfilesManager
          canOpenProfile={can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW)}
          teamEditUrl={teamUrl && can(actor, CAPABILITY.ADMIN_TEAM_MANAGE) ? teamUrl : null}
        />
        {can(actor, CAPABILITY.HR_EMPLOYEES_STATUTORY_MANAGE) && (
          <PageSection title="Change requests from employees">
            <ChangeRequestQueue onNotice={setNotice} onError={setError} />
          </PageSection>
        )}
      </PageBody>
    </div>
  );
}
