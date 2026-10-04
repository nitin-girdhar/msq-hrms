'use client';

import { useEffect, useState } from 'react';
import { employeeViews } from '../../lib/api/client';
import { ATTENDANCE_STATUS_STYLES, formatClockTime, formatDateTime, formatDay, formatWorkedMinutes } from '../../lib/attendance/format';
import { auditLabel, type AuditEntry, type Employee360AttendanceRow } from '../../lib/h7/types';
import { emptyBlockCls, fieldInputCls, stateBlockCls } from '../../lib/ui';

/** One person's month of attendance for HR (Employee 360). Read-only; corrections happen on the roster. */
export function AttendanceTab({ userId, onError }: { userId: string; onError: (m: string) => void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Employee360AttendanceRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    employeeViews.attendance(userId, month).then((r) => setRows(r.data)).catch((e) => { setRows([]); onError(e instanceof Error ? e.message : 'Failed to load attendance.'); });
  }, [userId, month, onError]);

  const worked = (rows ?? []).reduce((n, r) => n + (r.worked_minutes ?? 0), 0);
  const present = (rows ?? []).filter((r) => ['present', 'wfh', 'half_day'].includes(r.status_name)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" className={`${fieldInputCls} w-44`} />
        {rows && rows.length > 0 && <span className="text-xs text-on-surface-variant">{present} present · {formatWorkedMinutes(worked)} worked</span>}
      </div>
      {rows === null ? <div className={stateBlockCls}>Loading…</div> : rows.length === 0 ? <p className={emptyBlockCls}>No attendance recorded for this month.</p> : (
        <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          {rows.map((r) => {
            const s = ATTENDANCE_STATUS_STYLES[r.status_name as keyof typeof ATTENDANCE_STATUS_STYLES] ?? ATTENDANCE_STATUS_STYLES.not_marked;
            return (
              <li key={r.work_date} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="w-28 text-sm font-medium text-on-surface">{formatDay(r.work_date)}</span>
                <span className="text-xs tabular-nums text-on-surface-variant">{formatClockTime(r.first_in)} → {formatClockTime(r.last_out)} · {formatWorkedMinutes(r.worked_minutes)}</span>
                <span className="flex items-center gap-2">
                  {r.is_late && <span className="text-label-sm text-on-status-due-container">Late</span>}
                  {r.has_open_session && <span className="text-label-sm text-on-status-due-container">Missing check-out</span>}
                  <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium ${s.bg} ${s.fg}`}>{r.status_label}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Who did what about this person: action, actor and time only — never the values. */
export function AuditTab({ userId, onError }: { userId: string; onError: (m: string) => void }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    employeeViews.audit(userId).then((r) => setRows(r.data)).catch((e) => { setRows([]); onError(e instanceof Error ? e.message : 'Failed to load the audit trail.'); });
  }, [userId, onError]);
  if (rows === null) return <div className={stateBlockCls}>Loading…</div>;
  if (rows.length === 0) return <p className={emptyBlockCls}>Nothing recorded yet.</p>;
  return (
    <ol className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {rows.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <span className="text-sm text-on-surface">{auditLabel(a.action_type)}</span>
          <span className="text-label-sm text-outline">{a.performed_by_name ?? 'System'} · {formatDateTime(a.created_at)}</span>
        </li>
      ))}
    </ol>
  );
}

/** This month at a glance for the Overview: counted from the person's real day rows. */
export function AttendanceSnapshot({ userId, onOpen }: { userId: string; onOpen: () => void }) {
  const [rows, setRows] = useState<Employee360AttendanceRow[] | null>(null);
  const month = new Date().toISOString().slice(0, 7);
  useEffect(() => {
    setRows(null);
    employeeViews.attendance(userId, month).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [userId, month]);

  const present = (rows ?? []).filter((r) => ['present', 'wfh', 'half_day'].includes(r.status_name));
  const worked = present.reduce((n, r) => n + (r.worked_minutes ?? 0), 0);
  const onTime = present.length === 0 ? null : Math.round(((present.length - present.filter((r) => r.is_late).length) / present.length) * 100);
  const open = (rows ?? []).filter((r) => r.has_open_session).length;
  const stat = (label: string, value: string, hint: string) => (
    <div className="rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2.5">
      <p className="text-label-sm font-semibold text-on-surface-variant">{label}</p>
      <p className="font-mono text-headline-md font-bold tabular-nums text-on-surface">{value}</p>
      <p className="text-label-sm text-outline">{hint}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      {rows === null ? <div className={stateBlockCls}>Loading…</div> : (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {stat('Present days', String(present.length), `of ${rows.length} recorded`)}
          {stat('Avg worked', present.length ? formatWorkedMinutes(Math.round(worked / present.length)) : '—', 'per present day')}
          {stat('On-time', onTime === null ? '—' : `${onTime}%`, 'present days not late')}
          {stat('Open sessions', String(open), open === 1 ? 'check-out missing' : 'check-outs missing')}
        </div>
      )}
      <button type="button" onClick={onOpen} className="text-xs font-semibold text-primary hover:underline">View the day-by-day attendance →</button>
    </div>
  );
}
