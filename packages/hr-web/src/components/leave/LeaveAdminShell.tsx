'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import PoliciesManager from './admin/PoliciesManager';
import LeaveCycleSetting from './admin/LeaveCycleSetting';
import HolidaysManager from './admin/HolidaysManager';
import AdjustmentForm from './admin/AdjustmentForm';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

type Section = 'policies' | 'cycle' | 'holidays' | 'adjustment';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'policies', label: 'Policies' },
  { id: 'cycle', label: 'Leave cycle' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'adjustment', label: 'Adjustment' },
];

export default function LeaveAdminShell({ actor, hrRank }: Props) {
  const [section, setSection] = useState<Section>('policies');
  const [notice, setNotice] = useState<string | null>(null);

  const onNotice = (msg: string) => setNotice(msg);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Leave Administration"
        subtitle="Policies, leave cycle, holidays and manual adjustments. Employee profiles are under Employees in HR."
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}

        {/* Segmented control. The phone sizing (min-h-11, flex-1) is the 44px
            tap minimum the redesign audit measures; the four labels are short
            enough to share a row at 360px, so no sideways scroll is needed. */}
        <div
          role="tablist"
          aria-label="Leave administration sections"
          className="flex gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-1 shadow-sm"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              onClick={() => { setSection(s.id); setNotice(null); }}
              className={
                section === s.id
                  ? 'min-h-11 flex-1 rounded-lg bg-primary-fixed px-3 py-1.5 text-label-md font-semibold text-primary sm:min-h-0 sm:flex-none'
                  : 'min-h-11 flex-1 rounded-lg px-3 py-1.5 text-label-md font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low sm:min-h-0 sm:flex-none'
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === 'policies' && <PoliciesManager actor={actor} onNotice={onNotice} />}
        {section === 'cycle' && <LeaveCycleSetting actor={actor} onNotice={onNotice} />}
        {section === 'holidays' && <HolidaysManager onNotice={onNotice} />}
        {section === 'adjustment' && <AdjustmentForm onNotice={onNotice} />}
      </PageBody>
    </div>
  );
}
