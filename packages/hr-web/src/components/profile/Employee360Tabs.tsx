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
