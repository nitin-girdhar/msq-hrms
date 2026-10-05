'use client';

import { useEffect, useMemo, useState } from 'react';
import { attendance as attendanceApi, attendanceTools } from '../../lib/api/client';
import type { DayEventView, RegularizationView, ShiftSegmentView } from '../../lib/attendance/types';
import { formatClockTime, formatDay } from '../../lib/attendance/format';
import { formatSlotWindow, ownPunchesOnDate } from '../../lib/attendance/sessions';
import { fieldInputCls } from '../../lib/ui';
import SlotLog from './SlotLog';
import StatusPill from '../common/StatusPill';

type MyShift = { shift_id: string; shift_name: string; start_time: string; end_time: string; is_split: boolean; segments: ShiftSegmentView[] } | null;

const chipCls = (on: boolean) =>
  `shrink-0 rounded-full border px-3 py-0.5 text-xs font-semibold transition-colors ${on ? 'border-primary bg-primary-fixed text-on-primary-fixed' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`;

/**
 * Timesheet "Detailed slot log" (Stitch): pick a day, see its shift's slots and the punches made in each. The shift
 * comes from the caller's own assignment on that date (GET /attendance/me/shift, pinned to the session); the punches
 * from your own punch log, so it needs only attendance access.
 */
export function SlotLogTab({ today, timezone }: { today: string; timezone?: string | undefined }) {
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<MyShift | undefined>(undefined);
  const [events, setEvents] = useState<DayEventView[]>([]);
  const [slot, setSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setShift(undefined);
    setError(null);
    setSlot(null);
    attendanceApi.myShift(date).then((r) => { if (live) setShift(r.data); }).catch((e) => { if (live) { setShift(null); setError(e instanceof Error ? e.message : 'Could not load the shift.'); } });
    // The caller's own punch log (attendance.view): no dependency on the capability that reads anyone's selfies.
    attendanceTools.punches(date.slice(0, 7)).then((r) => { if (live) setEvents(ownPunchesOnDate(r.data, date, timezone)); }).catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [date, timezone]);

  const segments = shift?.segments ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" className={`${fieldInputCls} w-44`} />
        {shift && <span className="text-sm text-on-surface-variant"><span className="font-semibold text-on-surface">{shift.shift_name}</span> · {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</span>}
        {shift === null && !error && <span className="text-sm text-on-surface-variant">No shift was assigned on this day.</span>}
      </div>
      {segments.length > 1 && (
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Slot">
          <button type="button" onClick={() => setSlot(null)} className={chipCls(slot === null)}>All slots</button>
          {segments.map((s) => <button key={s.seq} type="button" onClick={() => setSlot(s.seq)} className={chipCls(slot === s.seq)}>Slot {s.seq} · {formatSlotWindow(s)}</button>)}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-status-overdue">{error}</p>}
      {shift === undefined ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <SlotLog segments={segments} events={events} onlySeq={slot} />
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, 'success' | 'due' | 'overdue' | 'neutral'> = { approved: 'success', pending: 'due', rejected: 'overdue', cancelled: 'neutral' };

/**
 * Timesheet "Shift regularization" (Stitch): your correction requests set against the shift they were for, so what
 * you asked for (in/out) is read next to the slot windows it should have fallen in. A request still covers a whole
 * day: it cannot yet target one slot (that would need a column the table does not have).
 */
export function ShiftRegularizationTab({ items, onNew }: { items: RegularizationView[]; onNew: () => void }) {
  const recent = useMemo(() => [...items].sort((a, b) => b.work_date.localeCompare(a.work_date)).slice(0, 10), [items]);
  const [shifts, setShifts] = useState<Record<string, MyShift>>({});

  useEffect(() => {
    let live = true;
    const dates = [...new Set(recent.map((r) => r.work_date))];
    Promise.all(dates.map((d) => attendanceApi.myShift(d).then((r) => [d, r.data] as const).catch(() => [d, null] as const)))
      .then((pairs) => { if (live) setShifts(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [recent]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-on-surface-variant">Your last {recent.length || 'few'} correction requests, against the shift of each day.</p>
        <button type="button" onClick={onNew} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-container-low">New request</button>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-on-surface-variant">You have not asked for any corrections.</p>
      ) : (
        <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          {recent.map((r) => {
            const sh = shifts[r.work_date];
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-on-surface">{formatDay(r.work_date)}</p>
                  <p className="text-xs text-on-surface-variant">
                    {sh ? <>Shift {sh.shift_name}{sh.segments.length > 0 ? ` (${sh.segments.map(formatSlotWindow).join(', ')})` : ` (${sh.start_time.slice(0, 5)}–${sh.end_time.slice(0, 5)})`}</> : 'No shift that day'}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    Asked for: {r.requested_in || r.requested_out ? `${formatClockTime(r.requested_in)} → ${formatClockTime(r.requested_out)}` : (r.requested_status_name ?? 'a status change')}
                  </p>
                </div>
                <StatusPill tone={STATUS_TONE[r.status] ?? 'neutral'} dot>{r.status[0]!.toUpperCase() + r.status.slice(1)}</StatusPill>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
