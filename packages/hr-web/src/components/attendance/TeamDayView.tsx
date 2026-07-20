'use client';

import type { TeamDayRow } from '../../lib/attendance/types';
import { ATTENDANCE_STATUS_STYLES, formatClockTime, formatWorkedMinutes } from '../../lib/attendance/format';

interface Props {
  rows: TeamDayRow[];
  loading: boolean;
}

export default function TeamDayView({ rows, loading }: Props) {
  if (loading) {
    return <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
        No team members found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">In</th>
            <th className="px-4 py-3">Out</th>
            <th className="px-4 py-3">Worked</th>
            <th className="px-4 py-3">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const style = ATTENDANCE_STATUS_STYLES[r.status_name] ?? ATTENDANCE_STATUS_STYLES.not_marked;
            return (
              <tr key={r.user_id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                <td className="px-4 py-3">
                  <p className="font-medium text-[#0F172A]">{r.user_full_name}</p>
                  <p className="text-[11px] text-[#94A3B8]">{r.user_email}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}>{r.status_label}</span>
                </td>
                <td className="px-4 py-3 text-[#475569]">{formatClockTime(r.first_in)}</td>
                <td className="px-4 py-3 text-[#475569]">{formatClockTime(r.last_out)}</td>
                <td className="px-4 py-3 text-[#475569]">{formatWorkedMinutes(r.worked_minutes)}</td>
                <td className="px-4 py-3 text-[11px] text-amber-700">
                  {r.is_late && <span className="mr-1">Late</span>}
                  {r.is_early_exit && <span>Early exit</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
