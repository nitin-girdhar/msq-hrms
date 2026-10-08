'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { CAPABILITY, holdsUsableNode } from '@platform/rbac';
import { Alert, PageBody, PageHeader } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import RulesEditor from './admin/RulesEditor';
import ShiftsManager from './admin/ShiftsManager';
import ShiftAssignmentsManager from './admin/ShiftAssignmentsManager';
import GeoExceptionsManager from './admin/GeoExceptionsManager';
import { canViewGeoExceptions } from '../../lib/attendance/format';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

type Section = 'rules' | 'shifts' | 'assignments' | 'exceptions';

export default function AttendanceAdminShell({ actor, hrRank }: Props) {
  // Each section is a TAB node of hr.attendance.admin: it appears for a role that holds the tab and
  // something beneath it. Exceptions keeps its own view check, so an attendance admin without it never
  // sees the tab the service would refuse them.
  const sections: { id: Section; label: string }[] = [
    ...(holdsUsableNode(actor, CAPABILITY.HR_ATTENDANCE_ADMIN_RULES) ? [{ id: 'rules' as const, label: 'Rules' }] : []),
    ...(holdsUsableNode(actor, CAPABILITY.HR_ATTENDANCE_ADMIN_SHIFTS) ? [{ id: 'shifts' as const, label: 'Shifts' }] : []),
    ...(holdsUsableNode(actor, CAPABILITY.HR_ATTENDANCE_ADMIN_ASSIGNMENTS) ? [{ id: 'assignments' as const, label: 'Assignments' }] : []),
    ...(canViewGeoExceptions(actor) ? [{ id: 'exceptions' as const, label: 'Exceptions' }] : []),
  ];
  const [section, setSection] = useState<Section>(sections[0]?.id ?? 'rules');
  const [notice, setNotice] = useState<string | null>(null);

  const onNotice = (msg: string) => setNotice(msg);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Attendance Administration"
        subtitle="Capture rules, shifts and shift assignments. Payroll reports are under Reports in HR."
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}

        {/* Segmented control — see LeaveAdminShell for the 44px phone sizing.
            Four labels at most (Exceptions is capability-gated away for some
            actors), so they still share one row at 360px. */}
        <div
          role="tablist"
          aria-label="Attendance administration sections"
          className="flex gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-1 shadow-sm"
        >
          {sections.map((s) => (
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

        {sections.length === 0 && <Alert tone="error">You do not have access to any attendance administration section.</Alert>}
        {section === 'rules' && sections.some((s) => s.id === 'rules') && <RulesEditor actor={actor} onNotice={onNotice} />}
        {section === 'shifts' && sections.some((s) => s.id === 'shifts') && <ShiftsManager actor={actor} onNotice={onNotice} />}
        {section === 'assignments' && sections.some((s) => s.id === 'assignments') && <ShiftAssignmentsManager actor={actor} onNotice={onNotice} />}
        {section === 'exceptions' && canViewGeoExceptions(actor) && <GeoExceptionsManager onNotice={onNotice} />}
      </PageBody>
    </div>
  );
}
