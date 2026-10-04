'use client';

import { useState } from 'react';
import { compOff } from '../../lib/api/client';
import type { CompOffClaim } from '../../lib/leave/types';
import { REGULARIZATION_STATUS_STYLES, formatDay } from '../../lib/attendance/format';
import { emptyBlockCls } from '../../lib/ui';

interface Props {
  items: CompOffClaim[];
  /** Called after a cancel succeeded, so the parent can refetch claims and balances. */
  onChanged: () => void;
  onError: (message: string) => void;
}

/** The employee's own comp-off claims: what was asked, its state, and when an approved credit runs out. */
export default function MyCompOffList({ items, onChanged, onError }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) return <p className={emptyBlockCls}>No comp-off claims yet.</p>;

  const cancel = async (id: string) => {
    setBusyId(id);
    try {
      await compOff.cancel(id);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not cancel the claim.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {items.map((c) => {
        const style = REGULARIZATION_STATUS_STYLES[c.status];
        return (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                {formatDay(c.worked_date)} <span className="font-normal text-on-surface-variant">· {c.days === 1 ? 'Full day' : 'Half day'}</span>
              </p>
              <p className="truncate text-xs text-on-surface-variant">{c.reason}</p>
              {c.status === 'approved' && c.expires_on && (
                <p className="text-label-sm text-outline">
                  {c.lapsed_at ? 'Expired' : `Use by ${formatDay(c.expires_on)}`}
                </p>
              )}
              {c.status === 'rejected' && c.approver_comment && (
                <p className="text-label-sm text-on-status-overdue-container">{c.approver_comment}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium capitalize ${style.bg} ${style.fg}`}>{c.status}</span>
              {c.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => void cancel(c.id)}
                  disabled={busyId === c.id}
                  aria-busy={busyId === c.id}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:opacity-50"
                >
                  {busyId === c.id ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
