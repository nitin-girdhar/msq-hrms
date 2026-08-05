'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import AttendanceTabs from './AttendanceTabs';
import RulesEditor from './admin/RulesEditor';
import ShiftsManager from './admin/ShiftsManager';
import ShiftAssignmentsManager from './admin/ShiftAssignmentsManager';
import GeoExceptionsManager from './admin/GeoExceptionsManager';
import MonthlySummaryReport from './admin/MonthlySummaryReport';
import { canViewGeoExceptions } from '../../lib/attendance/format';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

type Section = 'rules' | 'shifts' | 'assignments' | 'exceptions' | 'reports';

export default function AttendanceAdminShell({ actor, hrRank }: Props) {
  const [section, setSection] = useState<Section>('rules');
  // Exceptions carry their own capability, so an attendance admin without it
  // never sees the tab the service would refuse them.
  const sections: { id: Section; label: string }[] = [
    { id: 'rules', label: 'Rules' },
    { id: 'shifts', label: 'Shifts' },
    { id: 'assignments', label: 'Assignments' },
    ...(canViewGeoExceptions(actor) ? [{ id: 'exceptions' as const, label: 'Exceptions' }] : []),
    { id: 'reports', label: 'Reports' },
  ];
  const [notice, setNotice] = useState<string | null>(null);

  const onNotice = (msg: string) => setNotice(msg);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Attendance Administration"
        subtitle="Capture rules, shifts, shift assignments and payroll reports."
        tabs={<AttendanceTabs hrRank={hrRank} actor={actor} />}
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}

        <div className="flex flex-wrap gap-1 rounded-xl border border-[#E2E8F0] bg-white p-1 shadow-sm">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setSection(s.id); setNotice(null); }}
              className={
                section === s.id
                  ? 'rounded-lg bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#0b6cbf]'
                  : 'rounded-lg px-3 py-1.5 text-xs font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]'
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === 'rules' && <RulesEditor actor={actor} onNotice={onNotice} />}
        {section === 'shifts' && <ShiftsManager onNotice={onNotice} />}
        {section === 'assignments' && <ShiftAssignmentsManager onNotice={onNotice} />}
        {section === 'exceptions' && canViewGeoExceptions(actor) && <GeoExceptionsManager onNotice={onNotice} />}
        {section === 'reports' && <MonthlySummaryReport />}
      </PageBody>
    </div>
  );
}
