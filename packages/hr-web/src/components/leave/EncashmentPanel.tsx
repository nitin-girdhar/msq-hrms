'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { encashments, leaveExtras } from '../../lib/api/client';
import type { Encashment, PolicySummaryRow } from '../../lib/h7/types';
import { REGULARIZATION_STATUS_STYLES, formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

/** "Encash leave" request modal: only leave types whose policy allows it are offered. */
export function EncashRequestModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [types, setTypes] = useState<PolicySummaryRow[] | null>(null);
  const [type, setType] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    leaveExtras.policySummary().then((r) => setTypes(r.data.filter((p) => p.encashable))).catch(() => setTypes([]));
  }, []);

  const submit = async () => {
    setError(null);
    const n = Number(days);
    if (!type || !(n > 0)) { setError('Pick a leave type and the number of days.'); return; }
    setBusy(true);
    try {
      await encashments.create({ leave_type_name: type, days: n, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the request.');
    } finally { setBusy(false); }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={submit} disabled={busy || !types?.length} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Submitting…' : 'Submit request'}</button>
    </div>
  );
  const picked = types?.find((t) => t.leave_type_name === type);

  return (
    <Modal open onClose={onClose} title="Encash leave" locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        {types === null ? <div className={stateBlockCls}>Loading…</div> : types.length === 0 ? (
          <p className={emptyBlockCls}>No leave type can be encashed right now.</p>
        ) : (
          <>
            <p className="text-xs text-on-surface-variant">Cash out unused days. Once your approver agrees, the days are deducted from your balance.</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="en-type" className={fieldLabelCls}>Leave type</label>
              <select id="en-type" value={type} onChange={(e) => setType(e.target.value)} className={fieldInputCls} disabled={busy}>
                <option value="">Choose…</option>
                {types.map((t) => <option key={t.leave_type_name} value={t.leave_type_name}>{t.leave_type_label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="en-days" className={fieldLabelCls}>Days{picked?.max_encash_days ? ` (max ${picked.max_encash_days})` : ''}</label>
              <input id="en-days" type="number" min={0.5} step={0.5} value={days} onChange={(e) => setDays(e.target.value)} className={fieldInputCls} disabled={busy} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="en-reason" className={fieldLabelCls}>Note (optional)</label>
                <SpeechInputButton onText={(t) => setReason((p) => appendDictation(p, t, 500))} disabled={busy} />
              </div>
              <textarea id="en-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The employee's own encashment requests. */
export function MyEncashments({ refreshKey, onChanged, onError }: { refreshKey: number; onChanged: (m: string) => void; onError: (m: string) => void }) {
  const [items, setItems] = useState<Encashment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { encashments.mine().then((r) => setItems(r.data)).catch(() => setItems([])); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (items.length === 0) return <p className={emptyBlockCls}>No encashment requests yet.</p>;
  return (
    <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {items.map((e) => {
        const style = REGULARIZATION_STATUS_STYLES[e.status];
        return (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-on-surface">{e.leave_type_label} · {e.days} day{e.days === 1 ? '' : 's'}</p>
              <p className="text-label-sm text-outline">Requested {formatDateTime(e.created_at)}</p>
              {e.status === 'rejected' && e.approver_comment && <p className="text-label-sm text-on-status-overdue-container">{e.approver_comment}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium capitalize ${style.bg} ${style.fg}`}>{e.status}</span>
              {e.status === 'pending' && (
                <button type="button" disabled={busy === e.id} onClick={async () => {
                  setBusy(e.id);
                  try { await encashments.cancel(e.id); onChanged('Encashment request withdrawn.'); load(); } catch (err) { onError(err instanceof Error ? err.message : 'Could not withdraw.'); } finally { setBusy(null); }
                }} className="rounded-lg px-2 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:opacity-50">Withdraw</button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Encashment requests waiting for this approver. Scope is the server's. */
export function EncashmentQueue({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [items, setItems] = useState<Encashment[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<{ e: Encashment; approve: boolean } | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    encashments.queue('pending').then((r) => setItems(r.data)).catch((e) => onError(e instanceof Error ? e.message : 'Failed to load encashment requests.')).finally(() => setLoading(false));
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={stateBlockCls}>Loading…</div>;
  if (items.length === 0) return <p className={emptyBlockCls}>No encashment requests waiting.</p>;

  const submit = async () => {
    if (!deciding) return;
    if (!deciding.approve && !comment.trim()) { onError('A comment is required when rejecting.'); return; }
    setBusy(true);
    try {
      if (deciding.approve) await encashments.approve(deciding.e.id, comment.trim() || undefined);
      else await encashments.reject(deciding.e.id, comment.trim());
      onNotice(deciding.approve ? 'Encashment approved — the days were deducted.' : 'Encashment rejected.');
      setDeciding(null); setComment(''); load();
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not record the decision.'); } finally { setBusy(false); }
  };

  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((e) => (
          <li key={e.id} className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-on-surface">{e.user_full_name}</p><p className="truncate text-label-sm text-outline">{e.user_email}</p></div>
              <span className="shrink-0 rounded-full bg-status-info-container px-2 py-0.5 text-label-sm font-semibold text-on-status-info-container">{e.days} day{e.days === 1 ? '' : 's'}</span>
            </div>
            <p className="text-sm text-on-surface">Encash <span className="font-semibold">{e.leave_type_label}</span></p>
            {e.reason && <p className="line-clamp-2 text-xs text-on-surface-variant">{e.reason}</p>}
            <div className="mt-auto flex justify-end gap-2 pt-1">
              <Button variant="danger" onClick={() => { setDeciding({ e, approve: false }); setComment(''); }}>Reject</Button>
              <Button variant="primary" onClick={() => { setDeciding({ e, approve: true }); setComment(''); }}>Approve</Button>
            </div>
          </li>
        ))}
      </ul>
      {deciding && (
        <Modal open onClose={() => setDeciding(null)} title={`${deciding.approve ? 'Approve' : 'Reject'} encashment for ${deciding.e.user_full_name}`} locked={busy} maxWidth="max-w-md"
          footer={<div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeciding(null)} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant">Cancel</button>
            <button type="button" onClick={submit} disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-semibold ${deciding.approve ? 'bg-primary text-on-primary' : 'bg-status-overdue text-on-status-overdue'}`}>{busy ? 'Working…' : deciding.approve ? 'Approve' : 'Reject'}</button>
          </div>}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="eq-c" className={fieldLabelCls}>Comment {deciding.approve ? '(optional)' : '(required)'}</label>
            <textarea id="eq-c" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
          </div>
        </Modal>
      )}
    </>
  );
}
