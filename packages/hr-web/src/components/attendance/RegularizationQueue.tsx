'use client';

import type { RegularizationView } from '../../lib/attendance/types';
import { formatDay, formatDateTime } from '../../lib/attendance/format';
import ApprovalProgress from '../shared/ApprovalProgress';

interface Props {
  items: RegularizationView[];
  loading: boolean;
  onReview: (item: RegularizationView) => void;
}

export default function RegularizationQueue({ items, loading, onReview }: Props) {
  if (loading) {
    return <div className="flex items-center justify-center py-12 text-sm text-outline">Loading…</div>;
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-4 py-8 text-center text-sm text-outline">
        Nothing awaiting approval. You’re all caught up.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            <th className="px-4 py-3">Requester</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Requested</th>
            <th className="px-4 py-3">Reason</th>
            <th className="px-4 py-3">Approval</th>
            <th className="px-4 py-3">Submitted</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
              <td className="px-4 py-3 font-medium text-on-surface">{r.user_full_name ?? r.user_id}</td>
              <td className="px-4 py-3 text-on-surface-variant">{formatDay(r.work_date)}</td>
              <td className="px-4 py-3 text-on-surface-variant">{r.requested_status_name ?? '—'}</td>
              <td className="px-4 py-3 text-on-surface-variant">{r.reason}</td>
              <td className="px-4 py-3"><ApprovalProgress data={r} status={r.status} /></td>
              <td className="px-4 py-3 text-[0.6875rem] text-outline">{formatDateTime(r.created_at)}</td>
              <td className="px-4 py-3 text-right">
                <button type="button" onClick={() => onReview(r)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary/90">
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
