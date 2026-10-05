'use client';

import { useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { AttendanceDayRow, TodayPunchState } from '../../lib/attendance/types';
import { formatSlotWindow } from '../../lib/attendance/sessions';
import { formatWorkedMinutes } from '../../lib/attendance/format';

type Shift = { shift_name: string; start_time: string; end_time: string } | null;

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Two small cards at the foot of the HR sidebar (Stitch): Working time (today so far, against the shift's length)
 * and Assigned shift (name, window, the slot you are in). Read-only and the person's own: today's punch state,
 * their own day row and their own shift on today's date. Renders nothing without attendance access or without a
 * shift, and nothing until mounted, because the figures depend on the viewer's clock.
 */
export default function HrWorkCards({ actor }: { actor: SessionUser }) {
  const allowed = can(actor, CAPABILITY.HR_ATTENDANCE_VIEW);
  const [state, setState] = useState<TodayPunchState | undefined>(undefined);
  const [row, setRow] = useState<AttendanceDayRow | undefined>(undefined);
  const [shift, setShift] = useState<Shift>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    (async () => {
      try {
        const st = (await attendanceApi.todayState()).data;
        if (!live) return;
        setState(st);
        const [sh, me] = await Promise.all([
          attendanceApi.myShift(st.work_date).then((r) => r.data).catch(() => null),
          attendanceApi.me().then((r) => r.data.days.find((d) => d.work_date === st.work_date)).catch(() => undefined),
        ]);
        if (!live) return;
        setShift(sh);
        setRow(me);
      } catch { /* the cards are a nicety: no data, no cards */ }
    })();
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => { live = false; clearInterval(t); };
  }, [allowed]);

  if (!allowed || !shift || now === null) return null;

  const open = !!state?.can_check_out;
  const live = open && !state?.is_split && row?.first_in ? Math.max(0, Math.round((now - Date.parse(row.first_in)) / 60_000)) : null;
  const worked = live ?? row?.worked_minutes ?? 0;
  const length = Math.max(0, minutesOf(shift.end_time) - minutesOf(shift.start_time) + (minutesOf(shift.end_time) <= minutesOf(shift.start_time) ? 24 * 60 : 0));
  const pct = length > 0 ? Math.min(100, Math.round((worked / length) * 100)) : 0;
  const slot = state?.segments[Math.min(state.segments_punched, state.segments.length - 1)];

  return (
    <div className="flex flex-col gap-2" aria-label="Today at work">
      <div className="rounded-xl bg-surface-container-low p-3">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Working time</p>
        <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-on-surface">{formatWorkedMinutes(worked)}</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-container-highest" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the shift worked">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-label-sm text-on-surface-variant">{open ? 'Checked in' : row?.first_in ? 'Done for now' : 'Not checked in'} · {pct}% of the shift</p>
      </div>
      <div className="rounded-xl bg-surface-container-low p-3">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Assigned shift</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-on-surface">{shift.shift_name}</p>
        <p className="text-label-sm tabular-nums text-on-surface-variant">
          {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}{slot && state && state.segments.length > 1 ? ` · slot ${state.segments.indexOf(slot) + 1}: ${formatSlotWindow(slot)}` : ''}
        </p>
      </div>
    </div>
  );
}
