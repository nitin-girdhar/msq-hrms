'use client';

import { useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { RegularizationView } from '../../lib/attendance/types';
import { formatDay, formatDateTime } from '../../lib/attendance/format';

interface Props {
  request: RegularizationView | null;
  onClose: () => void;
  onDecided: (message: string) => void;
}

export default function RegularizationDecisionModal({ request, onClose, onDecided }: Props) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        await attendanceApi.regularizations.approve(request.id, comment.trim() || undefined);
        onDecided('Regularization approved.');
      } else {
        await attendanceApi.regularizations.reject(request.id, comment.trim());
        onDecided('Regularization rejected.');
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
    <Modal open onClose={onClose} title="Review regularization" locked={busy !== null} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm">
          <Row label="Requester" value={request.user_full_name ?? request.user_id} />
          <Row label="Date" value={formatDay(request.work_date)} />
          <Row label="Requested status" value={request.requested_status_name ?? '—'} />
          <Row label="Requested in" value={formatDateTime(request.requested_in)} />
          <Row label="Requested out" value={formatDateTime(request.requested_out)} />
          <Row label="Reason" value={request.reason} full />
        </dl>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rd-comment" className="text-xs font-semibold text-[#0F172A]">
            Comment <span className="font-normal text-[#94A3B8]">(required to reject)</span>
          </label>
          <textarea id="rd-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={inputCls} disabled={busy !== null} />
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
