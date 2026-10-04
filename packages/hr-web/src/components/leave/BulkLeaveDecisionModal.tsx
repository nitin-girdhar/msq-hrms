'use client';

import { useEffect, useState } from 'react';
import { Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { BulkLeaveOutcome, LeaveRequestView } from '../../lib/leave/types';
import { formatDateRange } from '../../lib/leave/format';
import { fieldInputCls } from '../../lib/ui';

interface Props {
  /** The selected requests; null closes the modal. */
  requests: LeaveRequestView[] | null;
  decision: 'approve' | 'reject';
  onClose: () => void;
  /** Called after the server answered — with the per-request outcome. */
  onDone: (outcome: BulkLeaveOutcome) => void;
}

/**
 * Confirms one decision for the selected requests. Each request is decided on the
 * server through the same path as a single decision, so a request this person may
 * not decide comes back skipped with its reason rather than failing the batch.
 */
export default function BulkLeaveDecisionModal({ requests, decision, onClose, onDone }: Props) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setComment('');
    setError(null);
  }, [requests, decision]);

  if (!requests) return null;
  const approving = decision === 'approve';

  const submit = async () => {
    setError(null);
    if (!approving && !comment.trim()) {
      setError('A comment is required when rejecting.');
      return;
    }
    setBusy(true);
    try {
      const trimmed = comment.trim();
      const res = await leaveApi.bulkDecide({
        request_ids: requests.map((r) => r.id),
        decision,
        ...(trimmed ? { comment: trimmed } : {}),
      });
      onDone(res.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record decisions.');
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">
        Cancel
      </button>
      <button type="button" onClick={submit} disabled={busy}
        className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
          approving ? 'bg-primary text-on-primary hover:bg-primary/90' : 'bg-status-overdue text-on-status-overdue hover:bg-status-overdue/90'
        }`}>
        {busy ? 'Working…' : `${approving ? 'Approve' : 'Reject'} ${requests.length}`}
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`${approving ? 'Approve' : 'Reject'} ${requests.length} request${requests.length === 1 ? '' : 's'}`} locked={busy} maxWidth="max-w-lg" footer={footer}>
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
        )}

        <ul className="max-h-48 divide-y divide-outline-variant/50 overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-low text-sm">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate font-medium text-on-surface">{r.user_full_name}</span>
              <span className="shrink-0 text-xs text-on-surface-variant">
                {r.leave_type_label} · {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="bld-comment" className="text-xs font-semibold text-on-surface">
              Comment <span className="font-normal text-outline">{approving ? '(optional)' : '(required, shared with every requester)'}</span>
            </label>
            <SpeechInputButton onText={(t) => setComment((p) => appendDictation(p, t))} disabled={busy} />
          </div>
          <textarea id="bld-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}
