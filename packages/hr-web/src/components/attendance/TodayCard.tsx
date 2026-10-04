'use client';

import { useEffect, useState } from 'react';
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

/**
 * Minutes worked so far today, ticking while a session is open.
 *
 * Closed sessions are summed from the punches; an open one counts up to "now".
 * Returns null when the punches are unavailable (a role without
 * hr.attendance.photo.view) so the card falls back to the day row's own figure
 * instead of showing a made-up zero.
 */
function liveWorkedMinutes(events: DayEventView[], now: number): number | null {
  if (events.length === 0) return null;
  let total = 0;
  for (const session of toSessions(events)) {
    const closed = sessionMinutes(session);
    if (closed != null) total += closed;
    else if (session.in && !session.out) total += Math.max(0, Math.round((now - Date.parse(session.in.occurred_at)) / 60_000));
  }
  return total;
}

export default function TodayCard({ todayRow, shift, punchState, todayEvents, onPunch, busy }: Props) {
  const hasCheckedIn = !!todayRow?.first_in;
  const { label, mode, disabled } = describe(punchState, hasCheckedIn);

  const showSlots = punchState?.is_split && punchState.segments_total > 0;
  const slotRows = showSlots ? toSlotRows(punchState!.segments, toSessions(todayEvents)) : [];

  // Re-render each 30s only while a session is open; otherwise the figure is
  // static and a timer would be pure churn.
  const open = !!punchState?.can_check_out;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [open]);
  const worked = liveWorkedMinutes(todayEvents, now) ?? todayRow?.worked_minutes ?? null;

  const statusLabel = todayRow?.status_label ?? (hasCheckedIn ? 'Present' : 'Not marked yet');
  const isPresent = todayRow?.status_name === 'present' || (!todayRow && hasCheckedIn);

  // Check-in is the brand action; check-out is the amber "closing" action so the
  // two never read alike (Stitch: punch-out is visually distinct). Both sit on the
  // brand hero card, so they use inverse surfaces rather than a fill that would
  // vanish into it.
  const buttonCls =
    mode === 'check_out' && !disabled
      ? 'bg-status-due text-on-status-due hover:bg-status-due/90'
      : 'bg-surface-container-lowest text-primary hover:bg-surface-container-low';

  return (
    <section className="overflow-hidden rounded-xl bg-primary-container text-on-primary-container shadow-lg">
      <div className="flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-label-sm font-semibold uppercase tracking-widest opacity-80">Today</p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-label-sm font-semibold ${
                isPresent ? 'bg-status-success text-on-status-success' : 'bg-on-primary-container/15 text-on-primary-container'
              }`}
            >
              {statusLabel}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-label-sm opacity-80">Working time</p>
              <p className="font-mono text-headline-lg font-bold tabular-nums text-on-primary">{formatWorkedMinutes(worked)}</p>
            </div>
            {!showSlots && (
              <>
                <div>
                  <p className="text-label-sm opacity-80">In</p>
                  <p className="text-headline-sm font-semibold tabular-nums text-on-primary">{formatClockTime(todayRow?.first_in ?? null)}</p>
                </div>
                <div>
                  <p className="text-label-sm opacity-80">Out</p>
                  <p className="text-headline-sm font-semibold tabular-nums text-on-primary">{formatClockTime(todayRow?.last_out ?? null)}</p>
                </div>
              </>
            )}
            {shift && (
              <div>
                <p className="text-label-sm opacity-80">Shift</p>
                <p className="text-headline-sm font-semibold text-on-primary">{shift.shift_name}</p>
              </div>
            )}
            {showSlots && (
              <div>
                <p className="text-label-sm opacity-80">Slots</p>
                <p className="text-headline-sm font-semibold tabular-nums text-on-primary">
                  {punchState!.segments_punched} of {punchState!.segments_total}
                </p>
              </div>
            )}
          </div>

          {/* Each slot's own in/out and the time spent inside it. first_in/last_out
              bracket the whole day, so on a split shift they span the unpaid gaps
              between slots; there they are replaced by this list rather than shown
              as a misleading pair. The scheduled window stays alongside so a slot
              still to come reads as pending rather than as missing data. */}
          {showSlots && slotRows.length > 0 && (
            <ol className="mt-4 flex flex-col gap-1.5">
              {slotRows.map((row) => {
                const minutes = row.session ? sessionMinutes(row.session) : null;
                return (
                  <li
                    key={row.seq}
                    className="flex items-center justify-between gap-3 rounded-lg bg-on-primary-container/10 px-3 py-1.5 text-xs"
                  >
                    <span className="flex items-center gap-2 tabular-nums">
                      <span className="font-semibold opacity-70">{row.seq}</span>
                      <span className="opacity-80">{row.scheduled ? formatSlotWindow(row.scheduled) : 'extra'}</span>
                      {row.session ? (
                        <span className="font-semibold text-on-primary">
                          {formatClockTime(row.session.in?.occurred_at ?? null)}
                          <span className="px-1 font-normal opacity-60">→</span>
                          {formatClockTime(row.session.out?.occurred_at ?? null)}
                        </span>
                      ) : (
                        <span className="opacity-70">Not started</span>
                      )}
                    </span>
                    <span className="opacity-80">
                      {row.session ? (minutes == null ? 'Open' : formatWorkedMinutes(minutes)) : '—'}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {punchState?.has_open_session && !punchState.can_check_out && (
            <p className="mt-3 rounded-lg bg-status-due-container px-3 py-1.5 text-label-md text-on-status-due-container">
              A slot was left open — it contributes no minutes. Raise a regularization to correct it.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onPunch(mode)}
          disabled={disabled || busy}
          className={`h-12 w-full shrink-0 rounded-lg px-6 text-sm font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto lg:min-w-48 ${buttonCls}`}
        >
          {label}
        </button>
      </div>
    </section>
  );
}
