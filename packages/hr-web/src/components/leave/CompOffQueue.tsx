'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { compOff } from '../../lib/api/client';
import type { CompOffClaim } from '../../lib/leave/types';
import { formatDay, formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, stateBlockCls } from '../../lib/ui';

interface Props {
  /** Reports the outcome to the page's notice / error banner. */
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Comp-off claims waiting for this approver. Scope is the server's: a leave admin
 * sees the whole branch, anyone else only claims assigned to them or from their
 * team, so nothing is filtered here.
 */
export default function CompOffQueue({ onNotice, onError }: Props) {
  const [items, setItems] = useState<CompOffClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<{ claim: CompOffClaim; decision: 'approve' | 'reject' } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    compOff
      .queue('pending')
      .then((res) => setItems(res.data))
      .catch((err) => onError(err instanceof Error ? err.message : 'Failed to load comp-off claims.'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={stateBlockCls}>Loading…</div>;
  if (items.length === 0) return <p className={emptyBlockCls}>No comp-off claims waiting.</p>;

  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-on-surface">{c.user_full_name}</p>
                <p className="truncate text-label-sm text-outline">{c.user_email}</p>
              </div>
              <span className="shrink-0 rounded-full bg-status-info-container px-2 py-0.5 text-label-sm font-semibold text-on-status-info-container">
                {c.days === 1 ? 'Full day' : 'Half day'}
              </span>
            </div>
            <p className="text-sm text-on-surface">
              Worked <span className="font-semibold">{formatDay(c.worked_date)}</span>
            </p>
            <p className="line-clamp-3 text-xs text-on-surface-variant">{c.reason}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <span className="text-label-sm text-outline">Claimed {formatDateTime(c.created_at)}</span>
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => setDeciding({ claim: c, decision: 'reject' })}>Reject</Button>
                <Button variant="primary" onClick={() => setDeciding({ claim: c, decision: 'approve' })}>Approve</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <DecisionModal
        target={deciding}
        onClose={() => setDeciding(null)}
        onDone={(message) => { onNotice(message); load(); }}
        onError={onError}
      />
    </>
  );
}

function DecisionModal({ target, onClose, onDone, onError }: {
  target: { claim: CompOffClaim; decision: 'approve' | 'reject' } | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setComment(''); setError(null); }, [target]);

  if (!target) return null;
  const approving = target.decision === 'approve';

  const submit = async () => {
    setError(null);
    if (!approving && !comment.trim()) { setError('A comment is required when rejecting.'); return; }
    setBusy(true);
    try {
      if (approving) await compOff.approve(target.claim.id, comment.trim() || undefined);
      else await compOff.reject(target.claim.id, comment.trim());
      onDone(approving ? 'Comp-off approved and credited.' : 'Comp-off rejected.');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record the decision.';
      setError(message);
      onError(message);
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
        className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60 ${approving ? 'bg-primary text-on-primary hover:bg-primary/90' : 'bg-status-overdue text-on-status-overdue hover:bg-status-overdue/90'}`}>
        {busy ? 'Working…' : approving ? 'Approve' : 'Reject'}
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`${approving ? 'Approve' : 'Reject'} comp-off for ${target.claim.user_full_name}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
        )}
        <p className="text-sm text-on-surface-variant">
          {formatDay(target.claim.worked_date)} · {target.claim.days === 1 ? 'Full day' : 'Half day'} — “{target.claim.reason}”
        </p>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="cq-comment" className="text-xs font-semibold text-on-surface">
              Comment <span className="font-normal text-outline">{approving ? '(optional)' : '(required)'}</span>
            </label>
            <SpeechInputButton onText={(t) => setComment((p) => appendDictation(p, t, 1000))} disabled={busy} />
          </div>
          <textarea id="cq-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}
