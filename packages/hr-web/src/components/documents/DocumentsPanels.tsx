'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from '@platform/ui-kit';
import { documents } from '../../lib/api/client';
import {
  DOCUMENT_ACCEPT, DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, DOCUMENT_DEFAULT_BYTES, DOCUMENT_MAX_BYTES, DOCUMENT_MIN_BYTES,
  expiryState, fileToBase64, formatBytes,
  type DocumentCategory, type EmployeeDocument, type PendingDocument,
} from '../../lib/documents/types';
import { formatDay } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_CLS: Record<string, string> = {
  verified: 'bg-status-success-container text-on-status-success-container',
  pending: 'bg-status-due-container text-on-status-due-container',
  rejected: 'bg-status-overdue-container text-on-status-overdue-container',
};
const STATUS_LABEL: Record<string, string> = { verified: 'Verified', pending: 'Awaiting review', rejected: 'Rejected' };

function StatusChip({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[status] ?? 'bg-surface-container text-on-surface-variant'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function ExpiryNote({ expiresOn }: { expiresOn: string | null }) {
  const state = expiryState(expiresOn, today());
  if (!expiresOn) return null;
  return (
    <span className={`text-label-sm ${state === 'expired' ? 'font-semibold text-status-overdue' : state === 'soon' ? 'font-semibold text-status-due' : 'text-outline'}`}>
      {state === 'expired' ? 'Expired ' : state === 'soon' ? 'Expires ' : 'Valid until '}{formatDay(expiresOn)}
    </span>
  );
}

interface RowProps {
  doc: EmployeeDocument & { user_full_name?: string };
  /** Actions shown at the right of the row. */
  actions?: React.ReactNode;
}

function DocumentRow({ doc, actions }: RowProps) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <a href={documents.fileUrl(doc.id)} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-semibold text-primary hover:underline">{doc.title}</a>
          <StatusChip status={doc.status} />
        </div>
        <p className="text-xs text-on-surface-variant">
          {doc.user_full_name ? `${doc.user_full_name} · ` : ''}{DOCUMENT_CATEGORY_LABEL[doc.category] ?? doc.category} · {doc.file_name} · {formatBytes(doc.size_bytes)} · added {formatDay(doc.created_at.slice(0, 10))}
          {doc.category === 'tax_proof' && doc.tax_section ? ` · Section ${doc.tax_section}` : ''}
          {doc.category === 'tax_proof' && doc.amount != null ? ` · ₹${doc.amount.toLocaleString('en-IN')}` : ''}
        </p>
        <ExpiryNote expiresOn={doc.expires_on} />
        {doc.status === 'rejected' && doc.review_note && <p className="mt-0.5 text-xs text-status-overdue">Reason: {doc.review_note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </li>
  );
}

const listCls = 'divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm';

/** The signed-in employee's own documents, with upload and remove. */
export function MyDocumentsPanel({ onError, onNotice }: { onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [items, setItems] = useState<EmployeeDocument[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [limit, setLimit] = useState(DOCUMENT_DEFAULT_BYTES);
  useEffect(() => { documents.settings().then((r) => setLimit(r.data.max_bytes)).catch(() => undefined); }, []);

  const load = useCallback(() => {
    documents.mine().then((r) => setItems(r.data)).catch((e) => { setItems([]); onError(e instanceof Error ? e.message : 'Failed to load your documents.'); });
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  const remove = async (d: EmployeeDocument) => {
    if (!window.confirm(`Remove "${d.title}"? The file is erased.`)) return;
    setBusyId(d.id);
    try { await documents.remove(d.id); onNotice('Document removed.'); load(); } catch (e) { onError(e instanceof Error ? e.message : 'Could not remove it.'); } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-on-surface-variant">PDF, JPG, PNG or WebP, up to {formatBytes(limit)} each. HR reviews what you upload.</p>
        <Button variant="primary" onClick={() => setUploading(true)}>Upload a document</Button>
      </div>
      {items === null ? <div className={stateBlockCls}>Loading…</div> : items.length === 0 ? (
        <p className={emptyBlockCls}>You have not uploaded anything yet.</p>
      ) : (
        <ul className={listCls}>
          {items.map((d) => (
            <DocumentRow key={d.id} doc={d} actions={
              d.status !== 'verified' && <Button variant="danger" disabled={busyId === d.id} onClick={() => void remove(d)}>Remove</Button>
            } />
          ))}
        </ul>
      )}
      {uploading && <UploadModal limit={limit} onClose={() => setUploading(false)} onUploaded={() => { setUploading(false); onNotice('Uploaded. HR will review it.'); load(); }} />}
    </div>
  );
}

/** HR's view of one person's documents on Employee 360: open, verify, reject, remove. */
export function EmployeeDocumentsPanel({ userId, onError }: { userId: string; onError: (m: string) => void }) {
  const [items, setItems] = useState<EmployeeDocument[] | null>(null);
  const [reviewing, setReviewing] = useState<EmployeeDocument | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    documents.forEmployee(userId).then((r) => setItems(r.data)).catch((e) => { setItems([]); onError(e instanceof Error ? e.message : 'Failed to load documents.'); });
  }, [userId, onError]);
  useEffect(() => { load(); }, [load]);

  const remove = async (d: EmployeeDocument) => {
    if (!window.confirm(`Remove "${d.title}"? The file is erased.`)) return;
    setBusyId(d.id);
    try { await documents.remove(d.id); load(); } catch (e) { onError(e instanceof Error ? e.message : 'Could not remove it.'); } finally { setBusyId(null); }
  };

  if (items === null) return <div className={stateBlockCls}>Loading…</div>;
  if (items.length === 0) return <p className={emptyBlockCls}>This person has not uploaded any documents.</p>;
  return (
    <>
      <ul className={listCls}>
        {items.map((d) => (
          <DocumentRow key={d.id} doc={d} actions={<>
            {d.status === 'pending' && <Button variant="primary" onClick={() => setReviewing(d)}>Review</Button>}
            <Button variant="secondary" disabled={busyId === d.id} onClick={() => void remove(d)}>Remove</Button>
          </>} />
        ))}
      </ul>
      {reviewing && <ReviewModal doc={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); load(); }} />}
    </>
  );
}

/** HR's inbox: every document waiting for review across the branch, oldest first. */
export function ReviewQueue({ onError, onNotice }: { onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [items, setItems] = useState<PendingDocument[] | null>(null);
  const [reviewing, setReviewing] = useState<PendingDocument | null>(null);

  const load = useCallback(() => {
    documents.pending().then((r) => setItems(r.data)).catch((e) => { setItems([]); onError(e instanceof Error ? e.message : 'Failed to load the review queue.'); });
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  if (items === null) return <div className={stateBlockCls}>Loading…</div>;
  if (items.length === 0) return <p className={emptyBlockCls}>Nothing is waiting for review.</p>;
  return (
    <>
      <ul className={listCls}>
        {items.map((d) => <DocumentRow key={d.id} doc={d} actions={<Button variant="primary" onClick={() => setReviewing(d)}>Review</Button>} />)}
      </ul>
      {reviewing && <ReviewModal doc={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); onNotice('Decision recorded.'); load(); }} />}
    </>
  );
}

function ReviewModal({ doc, onClose, onDone }: { doc: EmployeeDocument; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'verified' | 'rejected') => {
    setError(null);
    if (decision === 'rejected' && !note.trim()) { setError('Say why it is being rejected.'); return; }
    setBusy(true);
    try { await documents.review(doc.id, decision, note.trim() || undefined); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the decision.'); }
    finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={() => void decide('rejected')} disabled={busy} className="rounded-xl border border-status-overdue/40 bg-status-overdue-container px-4 py-2 text-sm font-semibold text-on-status-overdue-container disabled:opacity-60">Reject</button>
      <button type="button" onClick={() => void decide('verified')} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Saving…' : 'Verify'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Review: ${doc.title}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <p className="text-sm text-on-surface-variant">
          {DOCUMENT_CATEGORY_LABEL[doc.category] ?? doc.category} · {doc.file_name}.{' '}
          <a href={documents.fileUrl(doc.id)} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">Open the file</a> before deciding.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dr-note" className={fieldLabelCls}>Note (required to reject)</label>
          <textarea id="dr-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}

function UploadModal({ limit, onClose, onUploaded }: { limit: number; onClose: () => void; onUploaded: () => void }) {
  const [category, setCategory] = useState<DocumentCategory>('id_proof');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [expires, setExpires] = useState('');
  const [section, setSection] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | null) => {
    setError(null);
    if (f && f.size > limit) { setError(`That file is ${formatBytes(f.size)}; the limit is ${formatBytes(limit)}.`); setFile(null); return; }
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const save = async () => {
    setError(null);
    if (!file) { setError('Choose a file.'); return; }
    if (!title.trim()) { setError('Give the document a title.'); return; }
    const amt = amount.trim() === '' ? undefined : Number(amount);
    if (amt !== undefined && (!Number.isFinite(amt) || amt < 0)) { setError('Enter the amount as a positive number.'); return; }
    setBusy(true);
    try {
      const data_base64 = await fileToBase64(file);
      await documents.upload({
        category, title: title.trim(), file_name: file.name, data_base64,
        ...(expires ? { expires_on: expires } : {}),
        ...(category === 'tax_proof' && section.trim() ? { tax_section: section.trim() } : {}),
        ...(category === 'tax_proof' && amt !== undefined ? { amount: amt } : {}),
      });
      onUploaded();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not upload that file.'); } finally { setBusy(false); }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={() => void save()} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Uploading…' : 'Upload'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="Upload a document" locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="du-cat" className={fieldLabelCls}>Type</label>
          <select id="du-cat" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} className={fieldInputCls} disabled={busy}>
            {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="du-file" className={fieldLabelCls}>File (PDF, JPG, PNG or WebP, up to {formatBytes(limit)})</label>
          <input id="du-file" type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => pick(e.target.files?.[0] ?? null)} className="text-sm text-on-surface file:mr-3 file:rounded-lg file:border-0 file:bg-primary-fixed file:px-3 file:py-2 file:text-sm file:font-semibold file:text-on-primary-fixed" disabled={busy} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="du-title" className={fieldLabelCls}>Title</label>
          <input id="du-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="e.g. Aadhaar card, front and back" className={fieldInputCls} disabled={busy} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="du-exp" className={fieldLabelCls}>Expires on (optional)</label>
          <input id="du-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={`${fieldInputCls} w-44`} disabled={busy} />
        </div>
        {category === 'tax_proof' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><label htmlFor="du-sec" className={fieldLabelCls}>Section (e.g. 80C)</label><input id="du-sec" value={section} onChange={(e) => setSection(e.target.value)} maxLength={30} className={fieldInputCls} disabled={busy} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="du-amt" className={fieldLabelCls}>Amount (₹)</label><input id="du-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldInputCls} disabled={busy} /></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** HR sets the largest file people may upload, between 100 KB and 3.5 MB. */
export function UploadLimitCard({ onError, onNotice }: { onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [mb, setMb] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { documents.settings().then((r) => setMb(String(Math.round((r.data.max_bytes / (1024 * 1024)) * 100) / 100))).catch(() => undefined); }, []);

  const save = async () => {
    const bytes = Math.round(Number(mb) * 1024 * 1024);
    if (!Number.isFinite(bytes) || bytes < DOCUMENT_MIN_BYTES || bytes > DOCUMENT_MAX_BYTES) {
      onError(`Enter a size between ${formatBytes(DOCUMENT_MIN_BYTES)} and ${formatBytes(DOCUMENT_MAX_BYTES)}.`);
      return;
    }
    setBusy(true);
    try { await documents.saveSettings(bytes); onNotice('Upload limit saved.'); } catch (e) { onError(e instanceof Error ? e.message : 'Could not save the limit.'); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ul-mb" className={fieldLabelCls}>Largest upload (MB)</label>
        <input id="ul-mb" inputMode="decimal" value={mb} onChange={(e) => setMb(e.target.value)} className={`${fieldInputCls} w-32`} disabled={busy} />
      </div>
      <Button variant="secondary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save limit'}</Button>
      <p className="text-xs text-on-surface-variant">Between 0.1 and 3.5 MB. Files travel inside the request, so 3.5 MB is the most the platform accepts.</p>
    </div>
  );
}
