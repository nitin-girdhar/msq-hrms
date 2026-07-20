'use client';

import { useState } from 'react';
import type { SessionUser } from '@crm/types';
import AttendanceTabs from './AttendanceTabs';
import RulesEditor from './admin/RulesEditor';
import ShiftsManager from './admin/ShiftsManager';
import ShiftAssignmentsManager from './admin/ShiftAssignmentsManager';
import MonthlySummaryReport from './admin/MonthlySummaryReport';

interface Props {
  actor: SessionUser;
}

type Section = 'rules' | 'shifts' | 'assignments' | 'reports';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'rules', label: 'Rules' },
  { id: 'shifts', label: 'Shifts' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'reports', label: 'Reports' },
];

export default function AttendanceAdminShell({ actor }: Props) {
  const [section, setSection] = useState<Section>('rules');
  const [notice, setNotice] = useState<string | null>(null);

  const onNotice = (msg: string) => setNotice(msg);

  return (
    <div className="w-full space-y-6 px-3 py-4 sm:px-4">
      <AttendanceTabs actor={actor} />

      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Attendance Administration</h1>
        <p className="mt-1 text-sm text-[#64748B]">Capture rules, shifts, shift assignments and payroll reports.</p>
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
        {section === 'rules' && <RulesEditor actor={actor} onNotice={onNotice} />}
        {section === 'shifts' && <ShiftsManager onNotice={onNotice} />}
        {section === 'assignments' && <ShiftAssignmentsManager onNotice={onNotice} />}
        {section === 'reports' && <MonthlySummaryReport />}
      </div>
    </div>
  );
}
