'use client';

import { Button } from '@platform/ui-kit';
import type { AttendanceDayRow, ShiftAssignmentView } from '../../lib/attendance/types';
import { formatClockTime } from '../../lib/attendance/format';

interface Props {
  todayRow: AttendanceDayRow | undefined;
  shift: ShiftAssignmentView | undefined;
  onPunch: (mode: 'check_in' | 'check_out') => void;
  busy: boolean;
}

export default function TodayCard({ todayRow, shift, onPunch, busy }: Props) {
  const hasCheckedIn = !!todayRow?.first_in;
  const hasCheckedOut = !!todayRow?.last_out;

  let buttonLabel = 'Check in';
  let buttonMode: 'check_in' | 'check_out' = 'check_in';
  let buttonDisabled = false;
  if (hasCheckedIn && !hasCheckedOut) {
    buttonLabel = 'Check out';
    buttonMode = 'check_out';
  } else if (hasCheckedIn && hasCheckedOut) {
    buttonLabel = 'Completed for today';
    buttonDisabled = true;
  }

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#64748B]">Today</p>
          <h2 className="mt-0.5 text-lg font-bold text-[#0F172A]">
            {todayRow?.status_label ?? (hasCheckedIn ? 'Present' : 'Not marked yet')}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#64748B]">
            <span>In: <span className="font-semibold text-[#0F172A]">{formatClockTime(todayRow?.first_in ?? null)}</span></span>
            <span>Out: <span className="font-semibold text-[#0F172A]">{formatClockTime(todayRow?.last_out ?? null)}</span></span>
            {shift && <span>Shift: <span className="font-semibold text-[#0F172A]">{shift.shift_name}</span></span>}
          </div>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => onPunch(buttonMode)}
          disabled={buttonDisabled || busy}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
