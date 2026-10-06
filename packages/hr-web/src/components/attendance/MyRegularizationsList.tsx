'use client';

import { useState } from 'react';
import type { RegularizationView } from '../../lib/attendance/types';
import { REGULARIZATION_STATUS_STYLES, formatDay, formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, stateBlockCls } from '../../lib/ui';
import ApprovalProgress from '../shared/ApprovalProgress';

interface Props {
  items: RegularizationView[];
  loading: boolean;
  /** Opens the detail view. Always available, regardless of status. */
  onView: (item: RegularizationView) => void;
  /** Opens the form in edit mode. Omit to render the list read-only. */
  onEdit?: (item: RegularizationView) => void;
  /** Withdraws the request. Resolves once the server has accepted it. */
  onCancel?: (item: RegularizationView) => Promise<void>;
}

const LINK_BTN = 'rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed disabled:opacity-50';

export default function MyRegularizationsList({ items, loading, onView, onEdit, onCancel }: Props) {
  // Which row's cancel is in flight — the row disables itself rather than the
  // whole list, so a slow request never blocks acting on a different row.
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  if (loading) return <div className={stateBlockCls}>Loading…</div>;
  if (items.length === 0) return <p className={emptyBlockCls}>No regularization requests yet.</p>;

  const handleCancel = async (item: RegularizationView) => {
    if (!onCancel) return;
    setCancellingId(item.id);
    try {
      await onCancel(item);
    } finally {
      setCancellingId(null);
    }
  };

  // One set of actions for both layouts. Only a still-pending request is the
  // requester's to change: once an approver has acted, the decision — and the day
  // it may have flipped — is theirs to reverse, not the employee's.
  const actions = (r: RegularizationView) => {
    const editable = r.status === 'pending';
    const busy = cancellingId === r.id;
    return (
      <>
        <button type="button" onClick={() => onView(r)} disabled={busy} className={LINK_BTN}>
          View
        </button>
        {editable && onEdit && (
          <button type="button" onClick={() => onEdit(r)} disabled={busy} className={LINK_BTN}>
            Edit
          </button>
        )}
        {editable && onCancel && (
          <button
            type="button"
            onClick={() => void handleCancel(r)}
            disabled={busy}
            aria-busy={busy}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </>
    );
  };

  return (
    <>
      {/* Phone: one card per request. A 6-column table scrolled sideways is
          unusable at 390px, and the date/status/actions are all that matter there. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((r) => {
          const style = REGULARIZATION_STATUS_STYLES[r.status];
          return (
            <li key={r.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{formatDay(r.work_date)}</p>
                  <p className="text-xs text-on-surface-variant">{r.requested_status_name ?? '—'}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-label-sm font-medium capitalize ${style.bg} ${style.fg}`}>{r.status}</span>
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">{r.reason}</p>
              <div className="mt-2"><ApprovalProgress data={r} status={r.status} /></div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-label-sm text-outline">{formatDateTime(r.created_at)}</span>
                <div className="flex items-center gap-1">{actions(r)}</div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Approval</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const style = REGULARIZATION_STATUS_STYLES[r.status];
              return (
                <tr key={r.id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                  <td className="px-4 py-3 font-medium text-on-surface">{formatDay(r.work_date)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{r.requested_status_name ?? '—'}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{r.reason}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium ${style.bg} ${style.fg}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3"><ApprovalProgress data={r} status={r.status} /></td>
                  <td className="px-4 py-3 text-label-sm text-outline">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">{actions(r)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
