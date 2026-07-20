'use client';

import { useState } from 'react';
import type { SessionUser } from '@crm/types';
import LeaveTabs from './LeaveTabs';
import PoliciesManager from './admin/PoliciesManager';
import LeaveCycleSetting from './admin/LeaveCycleSetting';
import HolidaysManager from './admin/HolidaysManager';
import AdjustmentForm from './admin/AdjustmentForm';
import EmployeeProfilesManager from './admin/EmployeeProfilesManager';

interface Props {
  actor: SessionUser;
}

type Section = 'policies' | 'cycle' | 'holidays' | 'adjustment' | 'employees';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'policies', label: 'Policies' },
  { id: 'cycle', label: 'Leave cycle' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'adjustment', label: 'Adjustment' },
  { id: 'employees', label: 'Employees' },
];

export default function LeaveAdminShell({ actor }: Props) {
  const [section, setSection] = useState<Section>('policies');
  const [notice, setNotice] = useState<string | null>(null);

  const onNotice = (msg: string) => setNotice(msg);

  return (
    <div className="w-full space-y-6 px-3 py-4 sm:px-4">
      <LeaveTabs actor={actor} />

      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Leave Administration</h1>
        <p className="mt-1 text-sm text-[#64748B]">Policies, leave cycle, holidays, manual adjustments and employee profiles.</p>
      </div>

      {notice && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-700">{notice}</div>}

      <div className="flex flex-wrap gap-1 rounded-xl border border-[#E2E8F0] bg-white p-1 shadow-sm">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => { setSection(s.id); setNotice(null); }}
            className={
              section === s.id
                ? 'rounded-lg bg-[#EFF6FF] px-4 py-2 text-sm font-semibold text-[#0b6cbf]'
                : 'rounded-lg px-4 py-2 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]'
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <div>
        {section === 'policies' && <PoliciesManager actor={actor} onNotice={onNotice} />}
        {section === 'cycle' && <LeaveCycleSetting actor={actor} onNotice={onNotice} />}
        {section === 'holidays' && <HolidaysManager onNotice={onNotice} />}
        {section === 'adjustment' && <AdjustmentForm onNotice={onNotice} />}
        {section === 'employees' && <EmployeeProfilesManager onNotice={onNotice} />}
      </div>
    </div>
  );
}
