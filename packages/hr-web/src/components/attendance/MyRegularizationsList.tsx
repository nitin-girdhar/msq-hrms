'use client';

import { useState } from 'react';
import type { RegularizationView } from '../../lib/attendance/types';
import { REGULARIZATION_STATUS_STYLES, formatDay, formatDateTime } from '../../lib/attendance/format';

interface Props {
  items: RegularizationView[];
  loading: boolean;
  /** Opens the form in edit mode. Omit to render the list read-only. */
  onEdit?: (item: RegularizationView) => void;
  /** Withdraws the request. Resolves once the server has accepted it. */
  onCancel?: (item: RegularizationView) => Promise<void>;
}

export default function MyRegularizationsList({ items, loading, onEdit, onCancel }: Props) {
  // Which row's cancel is in flight — the row disables itself rather than the
  // whole table, so a slow request never blocks acting on a different row.
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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

  const actionable = !!onEdit || !!onCancel;

  const handleCancel = async (item: RegularizationView) => {
    if (!onCancel) return;
    setCancellingId(item.id);
    try {
      await onCancel(item);
    } finally {
      setCancellingId(null);
    }
  };

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
            {actionable && <th className="px-4 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const style = REGULARIZATION_STATUS_STYLES[r.status];
            // Only a still-pending request is the requester's to change: once an
            // approver has acted, the decision — and the day it may have flipped
            // — is theirs to reverse, not the employee's.
            const editable = r.status === 'pending';
            const busy = cancellingId === r.id;
            return (
              <tr key={r.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                <td className="px-4 py-3 font-medium text-[#0F172A]">{formatDay(r.work_date)}</td>
                <td className="px-4 py-3 text-[#475569]">{r.requested_status_name ?? '—'}</td>
                <td className="px-4 py-3 text-[#475569]">{r.reason}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-[11px] text-[#94A3B8]">{formatDateTime(r.created_at)}</td>
                {actionable && (
                  <td className="px-4 py-3">
                    {editable ? (
                      <div className="flex items-center justify-end gap-1">
                        {onEdit && (
                          <button
                            type="button"
                            onClick={() => onEdit(r)}
                            disabled={busy}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-[#0b6cbf] hover:bg-[#EFF6FF] disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
                        {onCancel && (
                          <button
                            type="button"
                            onClick={() => void handleCancel(r)}
                            disabled={busy}
                            aria-busy={busy}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-[#B91C1C] hover:bg-red-50 disabled:opacity-50"
                          >
                            {busy ? 'Cancelling…' : 'Cancel'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-right text-xs text-[#CBD5E1]">—</div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
