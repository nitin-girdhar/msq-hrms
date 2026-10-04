'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { PageBody, PageHeader } from '@platform/ui-kit';
import MonthlySummaryReport from './MonthlySummaryReport';
import MusterReport from './MusterReport';

interface Props {
  actor: SessionUser;
}

type Section = 'combined' | 'summary';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'combined', label: 'Combined attendance' },
  { id: 'summary', label: 'Monthly summary' },
];

// The HRMS "Reports" left-nav page (hr.reports tool). Until 1.56.0 the summary
// was the Reports tab of Attendance administration.
export default function ReportsShell({ actor }: Props) {
  const [section, setSection] = useState<Section>('combined');

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader title="Reports" subtitle="Monthly attendance for payroll — per branch or across every branch." />

      <PageBody>
        <div className="flex flex-wrap gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-1 shadow-sm">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={
                section === s.id
                  ? 'rounded-lg bg-primary-fixed px-3 py-1.5 text-xs font-semibold text-primary'
                  : 'rounded-lg px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low'
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === 'combined' && <MusterReport actor={actor} />}
        {section === 'summary' && <MonthlySummaryReport />}
      </PageBody>
    </div>
  );
}
