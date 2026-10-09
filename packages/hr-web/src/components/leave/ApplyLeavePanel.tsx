'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, InfoTip, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { documents, hrEmployees, leave as leaveApi } from '../../lib/api/client';
import type { HalfDay, HrLookupOption, LeaveBalance, LeavePreview } from '../../lib/leave/types';
import { DOCUMENT_ACCEPT, DOCUMENT_DEFAULT_BYTES, fileToBase64, formatBytes } from '../../lib/documents/types';
import { fieldInputCls, fieldLabelCls } from '../../lib/ui';
import { formatDays } from '../../lib/leave/format';

interface Props {
  userId: string;
  balances: LeaveBalance[];
  onApplied: () => void;
}

const HALVES: Array<[HalfDay, string]> = [['full', 'Full day'], ['first_half', '1st half'], ['second_half', '2nd half']];

interface Draft {
  type: string; start: string; end: string; startHalf: HalfDay; endHalf: HalfDay; reason: string; handover: string;
}

// Drafts live in this browser only: a "draft" status on the server would have to be honoured by balance,
// overlap, approver-queue and attendance logic that all treat every non-terminal request as an open one.
const draftKey = (userId: string) => `hr-leave-draft:${userId}`;
const readDraft = (userId: string): Draft | null => {
  try { const raw = window.localStorage.getItem(draftKey(userId)); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The leave application as a page section (Stitch "Apply for Time Off"): pick a type, set the dates, see
 * the working days it comes to, name who covers, add a document if the policy wants one, submit. The
 * server re-checks every rule (balance, notice, overlap, document, handover); this form only previews.
 */
export default function ApplyLeavePanel({ userId, balances, onApplied }: Props) {
  const types = useMemo(() => balances.filter((b) => b.has_policy), [balances]);
  const [type, setType] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [startHalf, setStartHalf] = useState<HalfDay>('full');
  const [endHalf, setEndHalf] = useState<HalfDay>('full');
  const [reason, setReason] = useState('');
  const [handover, setHandover] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [colleagues, setColleagues] = useState<HrLookupOption[]>([]);
  const [limit, setLimit] = useState(DOCUMENT_DEFAULT_BYTES);
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const seq = useRef(0);

  const selected = types.find((t) => t.leave_type_name === type);
  const allowHalf = selected?.allow_half_day ?? false;

  useEffect(() => { setHasDraft(readDraft(userId) !== null); }, [userId]);
  useEffect(() => { documents.settings().then((r) => setLimit(r.data.max_bytes)).catch(() => undefined); }, []);
  // Colleagues to hand over to. Not everyone may list employees; without access the field simply stays out.
  useEffect(() => {
    hrEmployees.list({ limit: 100, status: 'active' })
      .then((r) => setColleagues(r.data.filter((p) => p.user_id !== userId).map((p) => ({ id: p.user_id, name: p.full_name }))))
      .catch(() => setColleagues([]));
  }, [userId]);

  // Live working-days preview, as in the modal.
  useEffect(() => {
    if (!type || !start || !end || start > end) { setPreview(null); return; }
    const n = ++seq.current;
    setPreviewing(true);
    leaveApi
      .preview({ leave_type_name: type, start_date: start, end_date: end, start_half: allowHalf ? startHalf : 'full', end_half: allowHalf ? endHalf : 'full' })
      .then((r) => { if (n === seq.current) setPreview(r.data); })
      .catch(() => { if (n === seq.current) setPreview(null); })
      .finally(() => { if (n === seq.current) setPreviewing(false); });
  }, [type, start, end, startHalf, endHalf, allowHalf]);

  const needsDoc = preview != null && preview.requires_document_after_days != null && preview.days_count > preview.requires_document_after_days;

  const reset = () => { setType(''); setStart(''); setEnd(''); setStartHalf('full'); setEndHalf('full'); setReason(''); setHandover(''); setFile(null); setPreview(null); };

  const saveDraft = () => {
    try {
      window.localStorage.setItem(draftKey(userId), JSON.stringify({ type, start, end, startHalf, endHalf, reason, handover } satisfies Draft));
      setHasDraft(true); setNotice('Draft saved on this device.'); setError(null);
    } catch { setError('Could not save a draft in this browser.'); }
  };
  const resumeDraft = () => {
    const d = readDraft(userId);
    if (!d) return;
    setType(d.type); setStart(d.start); setEnd(d.end); setStartHalf(d.startHalf); setEndHalf(d.endHalf); setReason(d.reason); setHandover(d.handover);
    setNotice('Draft restored. Dates in the past need changing.');
  };
  const dropDraft = () => { try { window.localStorage.removeItem(draftKey(userId)); } catch { /* nothing to remove */ } setHasDraft(false); };

  const pickFile = (f: File | null) => {
    setError(null);
    if (f && f.size > limit) { setError(`That file is ${formatBytes(f.size)}; the limit is ${formatBytes(limit)}.`); setFile(null); return; }
    setFile(f);
  };

  const submit = async () => {
    setError(null); setNotice(null);
    if (!type) { setError('Choose a leave type.'); return; }
    if (!start || !end) { setError('Choose the dates.'); return; }
    if (end < start) { setError('The end date is before the start date.'); return; }
    if (needsDoc && !file) { setError(`A supporting document is required for more than ${preview!.requires_document_after_days} day(s).`); return; }
    setBusy(true);
    try {
      let attach: { attachment_token: string; attachment_name: string } | null = null;
      if (file) {
        const up = await leaveApi.uploadAttachment({ file_name: file.name, data_base64: await fileToBase64(file) });
        attach = { attachment_token: up.data.token, attachment_name: up.data.name };
      }
      await leaveApi.apply({
        leave_type_name: type, start_date: start, end_date: end,
        start_half: allowHalf ? startHalf : 'full', end_half: allowHalf ? endHalf : 'full',
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(handover ? { handover_user_id: handover } : {}),
        ...(attach ?? {}),
      });
      dropDraft(); reset(); setNotice('Leave request submitted for approval.');
      onApplied();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not submit the request.'); } finally { setBusy(false); }
  };

  return (
    <section id="apply-leave" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-on-surface">
            Apply for time off
            <InfoTip label="About applying">The server checks balance, notice and overlaps when you submit.</InfoTip>
          </h2>
        </div>
        {hasDraft && <button type="button" onClick={resumeDraft} className="text-xs font-semibold text-primary hover:underline">Resume saved draft</button>}
      </header>

      {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className={`${fieldLabelCls} mb-1.5`}>Leave type</legend>
          {types.length === 0 ? <p className="text-sm text-on-surface-variant">No leave type is open for you to book yet.</p> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {types.map((t) => (
                <button key={t.leave_type_id} type="button" aria-pressed={type === t.leave_type_name} onClick={() => setType(t.leave_type_name)} disabled={busy}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${type === t.leave_type_name ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-low text-on-surface hover:border-primary'}`}>
                  <span className="block text-sm font-semibold">{t.leave_type_label}</span>
                  <span className={`block text-label-sm ${type === t.leave_type_name ? 'opacity-90' : 'text-on-surface-variant'}`}>{t.balance} left</span>
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="al-start" className={fieldLabelCls}>Start date</label>
            <input id="al-start" type="date" min={today()} value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} className={fieldInputCls} disabled={busy} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="al-end" className={fieldLabelCls}>End date</label>
            <input id="al-end" type="date" min={start || today()} value={end} onChange={(e) => setEnd(e.target.value)} className={fieldInputCls} disabled={busy} />
          </div>
        </div>

        {allowHalf && (
          <div className="grid gap-3 sm:grid-cols-2">
            {([['Start day', startHalf, setStartHalf], ['End day', endHalf, setEndHalf]] as const).map(([label, value, set]) => (
              <fieldset key={label}>
                <legend className={`${fieldLabelCls} mb-1.5`}>{label}</legend>
                <div className="flex gap-1 rounded-lg border border-outline-variant bg-surface-container-low p-1">
                  {HALVES.map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)} disabled={busy}
                      className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold ${value === v ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>{l}</button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        {(previewing || preview) && (
          <div className={`rounded-xl border px-3 py-2 text-sm ${preview?.warnings.length ? 'border-status-due/30 bg-status-due-container text-on-status-due-container' : 'border-outline-variant bg-surface-container-low text-on-surface'}`}>
            {previewing && !preview ? 'Working out the days…' : preview && (
              <>
                <strong>{formatDays(preview.days_count)}</strong> of working days
                {selected && !selected.leave_type_name.includes('loss_of_pay') ? <> · balance after: <strong>{Math.round((preview.balance - preview.days_count) * 100) / 100}</strong></> : null}
                {preview.warnings.map((w) => <p key={w} className="text-xs">{w}</p>)}
              </>
            )}
          </div>
        )}

        {colleagues.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="al-handover" className={fieldLabelCls}>Work handover / backup colleague (optional)</label>
            <select id="al-handover" value={handover} onChange={(e) => setHandover(e.target.value)} className={fieldInputCls} disabled={busy}>
              <option value="">No one in particular</option>
              {colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="al-reason" className={fieldLabelCls}>Reason</label>
            <SpeechInputButton onText={(t) => setReason((p) => appendDictation(p, t, 1000))} disabled={busy} />
          </div>
          <textarea id="al-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} placeholder="Why you need the time off, or what to know about the handover" className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="al-file" className={fieldLabelCls}>
            Supporting document {needsDoc ? <strong className="text-status-overdue">(required for this length)</strong> : '(optional)'}
          </label>
          <input id="al-file" type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} disabled={busy}
            className="text-sm text-on-surface file:mr-3 file:rounded-lg file:border-0 file:bg-primary-fixed file:px-3 file:py-2 file:text-sm file:font-semibold file:text-on-primary-fixed" />
          <p className="text-label-sm text-on-surface-variant">PDF, JPG, PNG or WebP, up to {formatBytes(limit)}.{file ? ` Selected: ${file.name} (${formatBytes(file.size)}).` : ''}</p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={saveDraft} disabled={busy || !type}>Save draft</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || types.length === 0}>{busy ? 'Submitting…' : 'Submit for approval'}</Button>
        </div>
      </div>
    </section>
  );
}
