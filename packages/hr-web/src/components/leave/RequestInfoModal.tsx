'use client';

import { useState } from 'react';
import { Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { leaveExtras } from '../../lib/api/client';
import type { LeaveRequestView } from '../../lib/leave/types';
import { fieldInputCls, fieldLabelCls } from '../../lib/ui';

/**
 * The approver's "I need to know more": a question stored on the request, which stays
 * pending. The requester sees it on their request and answers by editing it.
 */
export default function RequestInfoModal({ request, onClose, onSent }: { request: LeaveRequestView; onClose: () => void; onSent: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!comment.trim()) { setError('Write your question.'); return; }
    setBusy(true);
    try { await leaveExtras.requestInfo(request.id, comment.trim()); onSent(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send the question.'); }
    finally { setBusy(false); }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={send} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Sending…' : 'Send question'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Ask ${request.user_full_name} for more information`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-2">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <p className="text-xs text-on-surface-variant">The request stays pending. They will see your question and can answer by editing the request.</p>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="ri-q" className={fieldLabelCls}>Your question</label>
          <SpeechInputButton onText={(t) => setComment((p) => appendDictation(p, t, 1000))} disabled={busy} />
        </div>
        <textarea id="ri-q" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
      </div>
    </Modal>
  );
}
