'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveRequestView, LeaveBalance } from '../../lib/leave/types';
import { formatDateRange, formatDays } from '../../lib/leave/format';

interface Props {
  request: LeaveRequestView | null;
  onClose: () => void;
  onDecided: (message: string) => void;
}

export default function ApprovalDecisionModal({ request, onClose, onDecided }: Props) {
  const [comment, setComment] = useState('');
  const [snapshot, setSnapshot] = useState<LeaveBalance | null>(null);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setComment('');
    setSnapshot(null);
    setError(null);
    if (!request) return;
    // Balance snapshot for the requester + this leave type.
    leaveApi
      .balancesForUser(request.user_id)
      .then((res) => {
        setSnapshot(res.data.find((b) => b.leave_type_id === request.leave_type_id) ?? null);
      })
      .catch(() => setSnapshot(null));
  }, [request]);

  if (!request) return null;

  const decide = async (action: 'approve' | 'reject') => {
    setError(null);
    if (action === 'reject' && !comment.trim()) {
      setError('A comment is required when rejecting.');
      return;
    }
    setBusy(action);
    try {
      if (action === 'approve') {
        await leaveApi.approve(request.id, comment.trim() || undefined);
        onDecided('Leave approved.');
      } else {
        await leaveApi.reject(request.id, comment.trim());
        onDecided('Leave rejected.');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record decision.');
    } finally {
      setBusy(null);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20';

  return (
    <Modal open onClose={onClose} title="Review leave request" locked={busy !== null} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm">
          <Row label="Requester" value={request.user_full_name} />
          <Row label="Type" value={request.leave_type_label} />
          <Row label="Dates" value={formatDateRange(request.start_date, request.end_date, request.start_half, request.end_half)} />
          <Row label="Days" value={formatDays(request.days_count)} />
          <Row label="Balance" value={snapshot ? formatDays(snapshot.balance) : '—'} />
          {request.reason && <Row label="Reason" value={request.reason} full />}
        </dl>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ad-comment" className="text-xs font-semibold text-[#0F172A]">
            Comment <span className="font-normal text-[#94A3B8]">(required to reject)</span>
          </label>
          <textarea id="ad-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={inputCls} disabled={busy !== null} />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy !== null}
            className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
            Close
          </button>
          <button type="button" onClick={() => decide('reject')} disabled={busy !== null}
            className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <button type="button" onClick={() => decide('approve')} disabled={busy !== null}
            className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">{label}</dt>
      <dd className="text-[#0F172A]">{value}</dd>
    </div>
  );
}
