'use client';

import type { RegularizationView } from '../../lib/attendance/types';
import { REGULARIZATION_STATUS_STYLES, formatDay, formatDateTime } from '../../lib/attendance/format';

interface Props {
  items: RegularizationView[];
  loading: boolean;
}

export default function MyRegularizationsList({ items, loading }: Props) {
  if (loading) {
    return <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>;
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
        No regularization requests yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Requested</th>
            <th className="px-4 py-3">Reason</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const style = REGULARIZATION_STATUS_STYLES[r.status];
            return (
              <tr key={r.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                <td className="px-4 py-3 font-medium text-[#0F172A]">{formatDay(r.work_date)}</td>
                <td className="px-4 py-3 text-[#475569]">{r.requested_status_name ?? '—'}</td>
                <td className="px-4 py-3 text-[#475569]">{r.reason}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-[11px] text-[#94A3B8]">{formatDateTime(r.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
