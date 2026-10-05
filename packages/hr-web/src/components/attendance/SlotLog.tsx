'use client';

import type { DayEventView, ShiftSegmentView } from '../../lib/attendance/types';
import { formatClockTime, formatWorkedMinutes } from '../../lib/attendance/format';
import { formatSlotWindow, sessionMinutes, toSessions, toSlotRows } from '../../lib/attendance/sessions';

interface Props {
  segments: ShiftSegmentView[];
  events: DayEventView[];
  /** Show only this slot (1-based), for the slot filter chips. */
  onlySeq?: number | null;
}

/**
 * One day's slots on a light surface: the scheduled window, the punches that were made in it, the time spent, and
 * a flag for a punch outside every window. For a shift with no declared slots it lists the day's sessions in order.
 * Pairing is the same helper the Today card and the day-detail window use (lib/attendance/sessions), so the three
 * cannot disagree.
 */
export default function SlotLog({ segments, events, onlySeq = null }: Props) {
  const rows = toSlotRows(segments, toSessions(events)).filter((r) => onlySeq == null || r.seq === onlySeq);
  if (rows.length === 0) return <p className="text-sm text-on-surface-variant">No punches on this day.</p>;
  const offSlot = (r: (typeof rows)[number]) => r.session?.in?.is_off_segment === true || r.session?.out?.is_off_segment === true;
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((r) => {
        const minutes = r.session ? sessionMinutes(r.session) : null;
        const open = !!r.session?.in && !r.session.out;
        return (
          <li key={r.seq} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 text-sm">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-fixed text-xs font-bold text-on-primary-fixed">{r.seq}</span>
              <span className="text-on-surface-variant">{r.scheduled ? formatSlotWindow(r.scheduled) : 'Outside the schedule'}</span>
              {r.session ? (
                <span className="font-semibold text-on-surface">
                  {formatClockTime(r.session.in?.occurred_at ?? null)}<span className="px-1 font-normal text-outline">→</span>{formatClockTime(r.session.out?.occurred_at ?? null)}
                </span>
              ) : <span className="text-outline">Not started</span>}
            </span>
            <span className="flex items-center gap-2 text-xs">
              {offSlot(r) && <span className="rounded-full bg-status-due-container px-2 py-0.5 font-semibold text-on-status-due-container">Off slot</span>}
              {open && <span className="rounded-full bg-status-info-container px-2 py-0.5 font-semibold text-on-status-info-container">Still open</span>}
              {minutes != null && <span className="font-mono font-semibold text-on-surface">{formatWorkedMinutes(minutes)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
