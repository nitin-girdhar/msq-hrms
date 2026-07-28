'use client';

import { Button } from '@platform/ui-kit';
import type { AttendanceDayRow, ShiftAssignmentView, TodayPunchState } from '../../lib/attendance/types';
import { formatClockTime } from '../../lib/attendance/format';

interface Props {
  todayRow: AttendanceDayRow | undefined;
  shift: ShiftAssignmentView | undefined;
  /** Server's answer to "what may I punch now?". Undefined only while loading. */
  punchState: TodayPunchState | undefined;
  onPunch: (mode: 'check_in' | 'check_out') => void;
  busy: boolean;
}

/**
 * The button state comes from `punchState`, NOT from the day row.
 *
 * first_in/last_out describe a single session, so on a split shift they read as
 * "done" the moment segment 1 closes — while the server would still accept
 * segment 2. Deriving the button here from those two fields is exactly the bug
 * that disabled check-in mid-split-shift.
 */
function describe(punchState: TodayPunchState | undefined, hasCheckedIn: boolean) {
  if (!punchState) {
    return { label: hasCheckedIn ? 'Check out' : 'Check in', mode: 'check_in' as const, disabled: true };
  }
  if (punchState.can_check_out) {
    return { label: 'Check out', mode: 'check_out' as const, disabled: false };
  }
  if (punchState.can_check_in) {
    // On a split shift name the segment being started, so it is obvious another
    // punch is expected later in the day.
    const label =
      punchState.is_split && punchState.segments_total > 0
        ? `Check in (slot ${punchState.segments_punched + 1} of ${punchState.segments_total})`
        : 'Check in';
    return { label, mode: 'check_in' as const, disabled: false };
  }
  return {
    label:
      punchState.check_in_blocked_by === 'SEGMENT_LIMIT_REACHED'
        ? 'All slots completed'
        : 'Completed for today',
    mode: 'check_in' as const,
    disabled: true,
  };
}

export default function TodayCard({ todayRow, shift, punchState, onPunch, busy }: Props) {
  const hasCheckedIn = !!todayRow?.first_in;
  const { label, mode, disabled } = describe(punchState, hasCheckedIn);

  const showSlots = punchState?.is_split && punchState.segments_total > 0;

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
            {showSlots && (
              <span>
                Slots: <span className="font-semibold text-[#0F172A]">{punchState!.segments_punched} of {punchState!.segments_total}</span>
              </span>
            )}
          </div>
          {/* On a split shift In/Out above are the day's FIRST in and LAST out, not
              the current slot — say so rather than let it read as a wrong total. */}
          {showSlots && (
            <p className="mt-1 text-[11px] text-[#64748B]">
              In/Out show the day’s first check-in and last check-out across all slots.
            </p>
          )}
          {punchState?.has_open_session && !punchState.can_check_out && (
            <p className="mt-1 text-[11px] text-[#B45309]">
              A slot was left open — it contributes no minutes. Raise a regularization to correct it.
            </p>
          )}
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => onPunch(mode)}
          disabled={disabled || busy}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}
