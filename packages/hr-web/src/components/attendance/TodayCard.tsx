'use client';

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
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0b6cbf]">Today</p>
          <h2 className="mt-1 text-lg font-bold text-[#0F172A]">
            {todayRow?.status_label ?? (hasCheckedIn ? 'Present' : 'Not marked yet')}
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#64748B]">
            <span>In: <span className="font-medium text-[#0F172A]">{formatClockTime(todayRow?.first_in ?? null)}</span></span>
            <span>Out: <span className="font-medium text-[#0F172A]">{formatClockTime(todayRow?.last_out ?? null)}</span></span>
            {shift && <span>Shift: <span className="font-medium text-[#0F172A]">{shift.shift_name}</span></span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onPunch(buttonMode)}
          disabled={buttonDisabled || busy}
          className="rounded-xl bg-[#0b6cbf] px-5 py-3 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
