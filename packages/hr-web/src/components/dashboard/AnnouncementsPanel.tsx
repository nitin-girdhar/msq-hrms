'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Button, Modal, PageSection } from '@platform/ui-kit';
import { announcements } from '../../lib/api/client';
import { ANNOUNCEMENT_CATEGORIES, type Announcement } from '../../lib/extras/types';
import { formatDay } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls } from '../../lib/ui';

interface Props {
  actor: SessionUser;
  onError: (message: string) => void;
}

// Category chips use the fixed categorical hues, so "Policy" reads the same for every tenant.
const CHIP: Record<string, string> = {
  general: 'bg-surface-container text-on-surface-variant',
  policy: 'bg-cat-blue-container text-on-cat-blue-container',
  event: 'bg-cat-orange-container text-on-cat-orange-container',
  celebration: 'bg-cat-pink-container text-on-cat-pink-container',
};

/** Branch announcements: unread first, mark as read, and (for HR) post and retire. */
export default function AnnouncementsPanel({ actor, onError }: Props) {
  const canManage = can(actor, CAPABILITY.HR_EMPLOYEES_ANNOUNCEMENTS_MANAGE);
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    announcements.list().then((r) => setItems(r.data)).catch((e) => onError(e instanceof Error ? e.message : 'Failed to load announcements.')).finally(() => setLoading(false));
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    setItems((xs) => xs.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    try { await announcements.markRead(id); } catch { load(); }
  };
  const retire = async (id: string) => {
    try { await announcements.retire(id); load(); } catch (e) { onError(e instanceof Error ? e.message : 'Could not retire it.'); }
  };

  const unread = items.filter((a) => !a.is_read).length;

  return (
    <PageSection
      title={`Announcements${unread > 0 ? ` (${unread} new)` : ''}`}
      action={canManage ? <Button variant="secondary" onClick={() => setComposing(true)}>Post</Button> : undefined}
    >
      {loading ? null : items.length === 0 ? (
        <p className={emptyBlockCls}>No announcements.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className={`rounded-xl border bg-surface-container-lowest p-4 shadow-sm ${a.is_read ? 'border-outline-variant' : 'border-primary/40'}`}>
              <div className="flex flex-wrap items-center gap-2">
                {!a.is_read && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                <span className={`rounded-full px-2 py-0.5 text-label-sm font-semibold capitalize ${CHIP[a.category] ?? CHIP.general}`}>{a.category}</span>
                {a.is_pinned && <span className="text-label-sm text-outline">Pinned</span>}
                <span className="ml-auto text-label-sm text-outline">{a.published_at ? formatDay(a.published_at.slice(0, 10)) : ''}{a.author_name ? ` · ${a.author_name}` : ''}</span>
              </div>
              <h3 className="mt-1.5 text-sm font-semibold text-on-surface">{a.title}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-on-surface-variant">{a.body}</p>
              <div className="mt-2 flex justify-end gap-1">
                {!a.is_read && <button type="button" onClick={() => void markRead(a.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed">Mark as read</button>}
                {canManage && <button type="button" onClick={() => void retire(a.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container">Retire</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {composing && <ComposeModal onClose={() => setComposing(false)} onPosted={() => { setComposing(false); load(); }} />}
    </PageSection>
  );
}

function ComposeModal({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<(typeof ANNOUNCEMENT_CATEGORIES)[number]>('general');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async () => {
    setError(null);
    if (!title.trim() || !body.trim()) { setError('A title and a message are required.'); return; }
    setBusy(true);
    try { await announcements.create({ title: title.trim(), body: body.trim(), category, is_pinned: pinned, publish: true }); onPosted(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not post.'); }
    finally { setBusy(false); }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={post} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Posting…' : 'Post to the branch'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="Post an announcement" locked={busy} maxWidth="max-w-lg" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <div className="flex flex-col gap-1.5"><label htmlFor="an-title" className={fieldLabelCls}>Title</label><input id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className={fieldInputCls} disabled={busy} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="an-body" className={fieldLabelCls}>Message</label><textarea id="an-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} className={`${fieldInputCls} h-auto py-2`} disabled={busy} /></div>
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={`${fieldInputCls} w-44`} disabled={busy}>
            {ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-on-surface"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} disabled={busy} className="h-4 w-4 accent-primary" />Pin to the top</label>
        </div>
      </div>
    </Modal>
  );
}
