'use client';

import { useEffect, useState } from 'react';
import { Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveRequestView, LeaveBalance, ApprovalReview } from '../../lib/leave/types';
import { formatDateRange, formatDays, formatDateTime } from '../../lib/leave/format';
import ApprovalReviewPanel from '../shared/ApprovalReviewPanel';

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
  const [review, setReview] = useState<ApprovalReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    setComment('');
    setSnapshot(null);
    setError(null);
    setReview(null);
    setReviewError(null);
    if (!request) return;
    setReviewLoading(true);
    leaveApi
      .approvals(request.id)
      .then((res) => setReview(res.data))
      .catch((err) => setReviewError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setReviewLoading(false));
    // Balance snapshot for the requester + this leave type.
    leaveApi
      .balancesForUser(request.user_id)
      .then((res) => {
        setSnapshot(res.data.find((b) => b.leave_type_id === request.leave_type_id) ?? null);
      })
      .catch(() => setSnapshot(null));
  }, [request]);

  if (!request) return null;

  // The server refuses a second approval from the same person; the dialog says so up front.
  const cannotApprove = review !== null && !review.my_decision.can_decide;

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
    'rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy !== null}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">
        Close
      </button>
      <button type="button" onClick={() => decide('reject')} disabled={busy !== null}
        className="rounded-xl border border-status-overdue/30 bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-status-overdue hover:bg-status-overdue-container disabled:opacity-60">
        {busy === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
      <button type="button" onClick={() => decide('approve')} disabled={busy !== null || cannotApprove}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60">
        {busy === 'approve' ? 'Approving…' : 'Approve'}
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Review leave request" locked={busy !== null} maxWidth="max-w-lg" footer={footer}>
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm">
          <Row label="Requester" value={request.user_full_name} />
          <Row label="Type" value={request.leave_type_label} />
          <Row label="Dates" value={formatDateRange(request.start_date, request.end_date, request.start_half, request.end_half)} />
          <Row label="Days" value={formatDays(request.days_count)} />
          <Row label="Balance" value={snapshot ? formatDays(snapshot.balance) : '—'} />
          {request.reason && <Row label="Reason" value={request.reason} full />}
        </dl>

        <ApprovalReviewPanel review={review} loading={reviewLoading} error={reviewError} formatDateTime={formatDateTime} />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="ad-comment" className="text-xs font-semibold text-on-surface">
              Comment <span className="font-normal text-outline">(required to reject)</span>
            </label>
            <SpeechInputButton onText={(t) => setComment((p) => appendDictation(p, t))} disabled={busy !== null} />
          </div>
          <textarea id="ad-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={inputCls} disabled={busy !== null} />
        </div>

      </div>
    </Modal>
  );
}

function Row({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-outline">{label}</dt>
      <dd className="text-on-surface">{value}</dd>
    </div>
  );
}
