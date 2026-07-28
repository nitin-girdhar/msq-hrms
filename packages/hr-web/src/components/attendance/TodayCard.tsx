'use client';

import { Button } from '@platform/ui-kit';
import type { AttendanceDayRow, DayEventView, ShiftAssignmentView, TodayPunchState } from '../../lib/attendance/types';
import { formatClockTime, formatWorkedMinutes } from '../../lib/attendance/format';
import { formatSlotWindow, sessionMinutes, toSessions, toSlotRows } from '../../lib/attendance/sessions';

interface Props {
  todayRow: AttendanceDayRow | undefined;
  shift: ShiftAssignmentView | undefined;
  /** Server's answer to "what may I punch now?". Undefined only while loading. */
  punchState: TodayPunchState | undefined;
  /** Today's individual punches, so a split shift can show each slot separately. */
  todayEvents: DayEventView[];
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

export default function TodayCard({ todayRow, shift, punchState, todayEvents, onPunch, busy }: Props) {
  const hasCheckedIn = !!todayRow?.first_in;
  const { label, mode, disabled } = describe(punchState, hasCheckedIn);

  const showSlots = punchState?.is_split && punchState.segments_total > 0;
  const slotRows = showSlots ? toSlotRows(punchState!.segments, toSessions(todayEvents)) : [];

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#64748B]">Today</p>
          <h2 className="mt-0.5 text-lg font-bold text-[#0F172A]">
            {todayRow?.status_label ?? (hasCheckedIn ? 'Present' : 'Not marked yet')}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#64748B]">
            {/* first_in/last_out bracket the whole day, so on a split shift they
                span the unpaid gaps between slots. There they are replaced by the
                per-slot list below rather than shown as a misleading pair. */}
            {!showSlots && (
              <>
                <span>In: <span className="font-semibold text-[#0F172A]">{formatClockTime(todayRow?.first_in ?? null)}</span></span>
                <span>Out: <span className="font-semibold text-[#0F172A]">{formatClockTime(todayRow?.last_out ?? null)}</span></span>
              </>
            )}
            {shift && <span>Shift: <span className="font-semibold text-[#0F172A]">{shift.shift_name}</span></span>}
            {showSlots && (
              <span>
                Slots: <span className="font-semibold text-[#0F172A]">{punchState!.segments_punched} of {punchState!.segments_total}</span>
              </span>
            )}
            {showSlots && (
              <span>
                Worked: <span className="font-semibold text-[#0F172A]">{formatWorkedMinutes(todayRow?.worked_minutes ?? null)}</span>
              </span>
            )}
          </div>
          {/* Each slot's own in/out and the time spent inside it. The scheduled
              window stays alongside so a slot still to come reads as pending
              rather than as missing data. */}
          {showSlots && slotRows.length > 0 && (
            <ol className="mt-2 flex flex-col gap-1">
              {slotRows.map((row) => {
                const minutes = row.session ? sessionMinutes(row.session) : null;
                return (
                  <li
                    key={row.seq}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-xs"
                  >
                    <span className="flex items-center gap-2 tabular-nums">
                      <span className="font-semibold text-[#94A3B8]">{row.seq}</span>
                      <span className="text-[#94A3B8]">
                        {row.scheduled ? formatSlotWindow(row.scheduled) : 'extra'}
                      </span>
                      {row.session ? (
                        <span className="font-semibold text-[#0F172A]">
                          {formatClockTime(row.session.in?.occurred_at ?? null)}
                          <span className="px-1 font-normal text-[#CBD5E1]">→</span>
                          {formatClockTime(row.session.out?.occurred_at ?? null)}
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">Not started</span>
                      )}
                    </span>
                    <span className="text-[#64748B]">
                      {row.session ? (minutes == null ? 'Open' : formatWorkedMinutes(minutes)) : '—'}
                    </span>
                  </li>
                );
              })}
            </ol>
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
