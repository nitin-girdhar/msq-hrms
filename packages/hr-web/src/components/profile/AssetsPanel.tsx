'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from '@platform/ui-kit';
import { assets } from '../../lib/api/client';
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, type Asset, type MyAsset } from '../../lib/extras/types';
import { formatDay } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls } from '../../lib/ui';

/** Read-only list of the equipment the signed-in employee holds (My profile). */
export function MyAssetsList() {
  const [items, setItems] = useState<MyAsset[] | null>(null);
  useEffect(() => { assets.mine().then((r) => setItems(r.data)).catch(() => setItems([])); }, []);
  if (items === null) return null;
  if (items.length === 0) return <p className={emptyBlockCls}>No equipment is assigned to you.</p>;
  return (
    <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-on-surface">{a.name}</p>
            <p className="text-xs text-on-surface-variant">{ASSET_CATEGORY_LABEL[a.category] ?? a.category} · Tag {a.asset_tag}{a.serial_no ? ` · S/N ${a.serial_no}` : ''}</p>
          </div>
          <span className="text-label-sm text-outline">Since {formatDay(a.assigned_on)}</span>
        </li>
      ))}
    </ul>
  );
}

/** HR's view on an Employee 360: what this person holds, assign something from stock, add new stock. */
export default function AssetsPanel({ userId, onError }: { userId: string; onError: (m: string) => void }) {
  const [all, setAll] = useState<Asset[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    assets.list().then((r) => setAll(r.data)).catch((e) => onError(e instanceof Error ? e.message : 'Failed to load assets.'));
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  const held = all.filter((a) => a.holder_id === userId);
  const stock = all.filter((a) => a.status === 'in_stock');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); setPick(''); load(); } catch (e) { onError(e instanceof Error ? e.message : 'That did not work.'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {held.length === 0 ? <p className={emptyBlockCls}>Nothing is assigned to this person.</p> : (
        <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          {held.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-on-surface">{a.name}</p>
                <p className="text-xs text-on-surface-variant">{ASSET_CATEGORY_LABEL[a.category] ?? a.category} · Tag {a.asset_tag}{a.assigned_on ? ` · since ${formatDay(a.assigned_on)}` : ''}</p>
              </div>
              <Button variant="danger" disabled={busy} onClick={() => void run(() => assets.returnAsset(a.id))}>Take back</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Assign from stock" value={pick} onChange={(e) => setPick(e.target.value)} className={`${fieldInputCls} w-64`} disabled={busy}>
          <option value="">Assign from stock…</option>
          {stock.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.asset_tag})</option>)}
        </select>
        <Button variant="primary" disabled={busy || !pick} onClick={() => void run(() => assets.assign(pick, userId))}>Assign</Button>
        <Button variant="secondary" onClick={() => setAdding(true)}>+ New asset</Button>
      </div>
      {adding && <NewAssetModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function NewAssetModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tag, setTag] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<(typeof ASSET_CATEGORIES)[number]>('laptop');
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!tag.trim() || !name.trim()) { setError('A tag and a name are required.'); return; }
    setBusy(true);
    try { await assets.create({ asset_tag: tag.trim(), name: name.trim(), category, ...(serial.trim() ? { serial_no: serial.trim() } : {}) }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the asset.'); }
    finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Saving…' : 'Add to stock'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="New asset" locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <div className="flex flex-col gap-1.5"><label htmlFor="as-tag" className={fieldLabelCls}>Asset tag</label><input id="as-tag" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={50} className={fieldInputCls} disabled={busy} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="as-name" className={fieldLabelCls}>Name</label><input id="as-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder="e.g. MacBook Pro 14" className={fieldInputCls} disabled={busy} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><label htmlFor="as-cat" className={fieldLabelCls}>Category</label>
            <select id="as-cat" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={fieldInputCls} disabled={busy}>
              {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABEL[c]}</option>)}
            </select></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="as-sn" className={fieldLabelCls}>Serial no.</label><input id="as-sn" value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={100} className={fieldInputCls} disabled={busy} /></div>
        </div>
      </div>
    </Modal>
  );
}
