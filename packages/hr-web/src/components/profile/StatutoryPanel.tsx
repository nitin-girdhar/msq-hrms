'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from '@platform/ui-kit';
import { statutory } from '../../lib/api/client';
import {
  EMPTY_STATUTORY_FORM,
  STATUTORY_LABELS,
  maskTail,
  toStatutoryForm,
  type ChangeRequest,
  type StatutoryForm,
  type StatutoryValues,
} from '../../lib/h7/types';
import { REGULARIZATION_STATUS_STYLES, formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

const MASKED_KEYS = new Set<keyof StatutoryValues>(['pan', 'aadhaar', 'uan', 'account_number']);
const KEYS = Object.keys(STATUTORY_LABELS) as Array<keyof StatutoryValues>;

/** One field row: label + value, hiding the identifier unless `reveal`. */
function Facts({ values, reveal }: { values: StatutoryValues | null; reveal: boolean }) {
  return (
    <dl className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {KEYS.map((k) => {
        const raw = values?.[k] ?? null;
        const shown = !raw ? '—' : MASKED_KEYS.has(k) && !reveal ? maskTail(raw) : raw;
        return (
          <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="shrink-0 text-on-surface-variant">{STATUTORY_LABELS[k]}</dt>
            <dd className="min-w-0 text-right font-medium tabular-nums text-on-surface">{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The editable fields, shared by HR's edit and the employee's change request. */
export function StatutoryFields({ form, onChange, disabled }: { form: StatutoryForm; onChange: (k: keyof StatutoryForm, v: string) => void; disabled: boolean }) {
  const text = (k: keyof StatutoryForm, extra?: { placeholder?: string; max?: number }) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`st-${k}`} className={fieldLabelCls}>{STATUTORY_LABELS[k]}</label>
      <input id={`st-${k}`} value={form[k]} onChange={(e) => onChange(k, e.target.value)} placeholder={extra?.placeholder} maxLength={extra?.max ?? 100} disabled={disabled} autoComplete="off" className={fieldInputCls} />
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {text('pan', { placeholder: 'ABCDE1234F', max: 10 })}
      {text('aadhaar', { placeholder: '12 digits', max: 14 })}
      {text('uan', { placeholder: '12 digits', max: 14 })}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="st-tax_regime" className={fieldLabelCls}>{STATUTORY_LABELS.tax_regime}</label>
        <select id="st-tax_regime" value={form.tax_regime} onChange={(e) => onChange('tax_regime', e.target.value)} disabled={disabled} className={fieldInputCls}>
          <option value="">—</option><option value="old">Old regime</option><option value="new">New regime</option>
        </select>
      </div>
      {text('bank_name')}
      {text('bank_branch')}
      {text('account_number', { placeholder: '6–20 digits', max: 24 })}
      {text('ifsc', { placeholder: 'HDFC0001234', max: 11 })}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="st-account_type" className={fieldLabelCls}>{STATUTORY_LABELS.account_type}</label>
        <select id="st-account_type" value={form.account_type} onChange={(e) => onChange('account_type', e.target.value)} disabled={disabled} className={fieldInputCls}>
          <option value="">—</option><option value="savings">Savings</option><option value="current">Current</option>
        </select>
      </div>
    </div>
  );
}

const PLAIN_TEXT_NOTE = 'These details are stored without encryption for now, so access is limited and every view or change by someone else is logged.';

/**
 * HR's panel on an Employee 360. Everyone who can open the profile sees the MASKED view; people
 * with hr.employees.statutory.manage can reveal the numbers (audited server-side) and edit them.
 */
export default function StatutoryPanel({ userId, canManage, onError }: { userId: string; canManage: boolean; onError: (m: string) => void }) {
  const [masked, setMasked] = useState<StatutoryValues | null>(null);
  const [values, setValues] = useState<StatutoryValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    statutory.forEmployee(userId).then((r) => { setMasked(r.data.masked); setValues(r.data.values); }).catch((e) => onError(e instanceof Error ? e.message : 'Failed to load details.')).finally(() => setLoading(false));
  }, [userId, onError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={stateBlockCls}>Loading…</div>;
  const hasAnything = masked !== null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-variant">{PLAIN_TEXT_NOTE}</p>
      {!hasAnything ? <p className={emptyBlockCls}>No statutory or bank details on file.</p> : <Facts values={reveal && values ? values : masked} reveal={reveal && !!values} />}
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <>
            <Button variant="secondary" onClick={() => setReveal((r) => !r)} disabled={!hasAnything}>{reveal ? 'Hide numbers' : 'Show numbers'}</Button>
            <Button variant="primary" onClick={() => setEditing(true)}>{hasAnything ? 'Edit' : 'Add details'}</Button>
          </>
        )}
      </div>
      {editing && <EditModal userId={userId} initial={values} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}

function EditModal({ userId, initial, onClose, onSaved }: { userId: string; initial: StatutoryValues | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<StatutoryForm>(toStatutoryForm(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    setBusy(true);
    try { await statutory.save(userId, form); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="Statutory and bank details" locked={busy} maxWidth="max-w-xl" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <StatutoryFields form={form} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} disabled={busy} />
      </div>
    </Modal>
  );
}

/**
 * The employee's own section on My profile: their details (hidden until they choose to show
 * them), and a way to ask HR for a change. A change is a REQUEST: nothing is edited until HR
 * approves it.
 */
export function MyStatutorySection({ onError, onNotice }: { onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [mine, setMine] = useState<StatutoryValues | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [reveal, setReveal] = useState(false);
  const [asking, setAsking] = useState(false);
  const load = useCallback(() => {
    statutory.mine().then((r) => setMine(r.data)).catch((e) => onError(e instanceof Error ? e.message : 'Failed to load your details.'));
    statutory.myRequests().then((r) => setRequests(r.data)).catch(() => setRequests([]));
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  const pending = requests.find((r) => r.status === 'pending');

  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-variant">{PLAIN_TEXT_NOTE}</p>
      {mine ? <Facts values={mine} reveal={reveal} /> : <p className={emptyBlockCls}>HR has not added your statutory or bank details yet.</p>}
      <div className="flex flex-wrap gap-2">
        {mine && <Button variant="secondary" onClick={() => setReveal((r) => !r)}>{reveal ? 'Hide numbers' : 'Show numbers'}</Button>}
        <Button variant="primary" onClick={() => setAsking(true)} disabled={!!pending}>{pending ? 'Change request pending' : 'Request a change'}</Button>
      </div>
      {requests.length > 0 && (
        <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          {requests.slice(0, 5).map((r) => {
            const style = REGULARIZATION_STATUS_STYLES[r.status];
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div>
                  <p className="text-sm text-on-surface">Change to {Object.keys(r.payload).map((k) => STATUTORY_LABELS[k as keyof StatutoryValues] ?? k).join(', ')}</p>
                  <p className="text-label-sm text-outline">{formatDateTime(r.created_at)}{r.status === 'rejected' && r.reviewer_comment ? ` · ${r.reviewer_comment}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium capitalize ${style.bg} ${style.fg}`}>{r.status}</span>
                  {r.status === 'pending' && <button type="button" onClick={async () => { try { await statutory.cancelRequest(r.id); onNotice('Change request withdrawn.'); load(); } catch (e) { onError(e instanceof Error ? e.message : 'Could not withdraw.'); } }} className="rounded-lg px-2 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container">Withdraw</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {asking && <ChangeModal initial={mine} onClose={() => setAsking(false)} onSent={() => { setAsking(false); onNotice('Change request sent to HR.'); load(); }} />}
    </div>
  );
}

function ChangeModal({ initial, onClose, onSent }: { initial: StatutoryValues | null; onClose: () => void; onSent: () => void }) {
  const base = toStatutoryForm(initial);
  const [form, setForm] = useState<StatutoryForm>(base);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    // Only what actually changed goes to HR.
    const payload: Partial<StatutoryForm> = {};
    for (const k of Object.keys(EMPTY_STATUTORY_FORM) as Array<keyof StatutoryForm>) if (form[k] !== base[k]) payload[k] = form[k];
    if (Object.keys(payload).length === 0) { setError('Change at least one field.'); return; }
    setBusy(true);
    try { await statutory.requestChange(payload, reason.trim() || undefined); onSent(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send the request.'); setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={send} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Sending…' : 'Send to HR'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="Request a change" locked={busy} maxWidth="max-w-xl" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <p className="text-xs text-on-surface-variant">Change what needs changing. HR reviews it; nothing is updated until they approve.</p>
        <StatutoryFields form={form} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} disabled={busy} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cr-reason" className={fieldLabelCls}>Why? (optional)</label>
          <input id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={fieldInputCls} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}

/** HR's queue of employees' change requests (shown on the Employees page for statutory.manage). */
export function ChangeRequestQueue({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<{ r: ChangeRequest; approve: boolean } | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { statutory.queue('pending').then((r) => setItems(r.data)).catch((e) => onError(e instanceof Error ? e.message : 'Failed to load change requests.')).finally(() => setLoading(false)); }, [onError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={stateBlockCls}>Loading…</div>;
  if (items.length === 0) return <p className={emptyBlockCls}>No change requests waiting.</p>;

  const submit = async () => {
    if (!deciding) return;
    if (!deciding.approve && !comment.trim()) { onError('A comment is required when rejecting.'); return; }
    setBusy(true);
    try {
      if (deciding.approve) await statutory.approve(deciding.r.id, comment.trim() || undefined); else await statutory.reject(deciding.r.id, comment.trim());
      onNotice(deciding.approve ? 'Change approved and applied.' : 'Change rejected.');
      setDeciding(null); setComment(''); load();
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not record the decision.'); } finally { setBusy(false); }
  };

  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
            <p className="text-sm font-semibold text-on-surface">{r.user_full_name}</p>
            <dl className="space-y-0.5 text-xs">
              {(Object.keys(r.payload) as Array<keyof StatutoryValues>).map((k) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-on-surface-variant">{STATUTORY_LABELS[k] ?? k}</dt><dd className="font-medium tabular-nums text-on-surface">{r.payload[k] === '' ? '(clear)' : r.payload[k]}</dd></div>
              ))}
            </dl>
            {r.reason && <p className="text-xs text-on-surface-variant">“{r.reason}”</p>}
            <div className="mt-auto flex justify-end gap-2 pt-1">
              <Button variant="danger" onClick={() => { setDeciding({ r, approve: false }); setComment(''); }}>Reject</Button>
              <Button variant="primary" onClick={() => { setDeciding({ r, approve: true }); setComment(''); }}>Approve</Button>
            </div>
          </li>
        ))}
      </ul>
      {deciding && (
        <Modal open onClose={() => setDeciding(null)} title={`${deciding.approve ? 'Approve' : 'Reject'} change for ${deciding.r.user_full_name}`} locked={busy} maxWidth="max-w-md"
          footer={<div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeciding(null)} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant">Cancel</button>
            <button type="button" onClick={submit} disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-semibold ${deciding.approve ? 'bg-primary text-on-primary' : 'bg-status-overdue text-on-status-overdue'}`}>{busy ? 'Working…' : deciding.approve ? 'Approve' : 'Reject'}</button>
          </div>}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cq-c" className={fieldLabelCls}>Comment {deciding.approve ? '(optional)' : '(required)'}</label>
            <textarea id="cq-c" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
          </div>
        </Modal>
      )}
    </>
  );
}
