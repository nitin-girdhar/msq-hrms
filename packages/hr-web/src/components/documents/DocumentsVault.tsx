'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import StatCard from '../common/StatCard';
import { expiryState, financialYearOf, TAB_OF_CATEGORY, VAULT_TABS, type EmployeeDocument, type VaultTab } from '../../lib/documents/types';
import { emptyBlockCls, fieldInputCls } from '../../lib/ui';

interface Props {
  items: EmployeeDocument[];
  /** Renders one document row (the caller owns the actions). */
  renderRow: (d: EmployeeDocument) => ReactNode;
  /** Same-origin URL of the "download everything" ZIP. */
  dossierHref: string;
  /** Today as YYYY-MM-DD, for the expiry tile. */
  today: string;
}

const chipCls = (on: boolean) =>
  `shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${on ? 'border-primary bg-primary-fixed text-on-primary-fixed' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`;

/**
 * The vault's browsing layer (Stitch "Documents"): three summary tiles, category tabs with counts, search, a
 * financial-year filter, the rows, and a tax-proof summary by section. It filters what the server already
 * returned, so it adds no new read.
 */
export default function DocumentsVault({ items, renderRow, dossierHref, today }: Props) {
  const [tab, setTab] = useState<VaultTab>('all');
  const [q, setQ] = useState('');
  const [fy, setFy] = useState<string>('all');

  const counts = useMemo(() => {
    const c: Record<VaultTab, number> = { all: items.length, identity: 0, work: 0, tax: 0, other: 0 };
    for (const d of items) c[TAB_OF_CATEGORY[d.category] ?? 'other']++;
    return c;
  }, [items]);

  const years = useMemo(() => [...new Set(items.filter((d) => d.category === 'tax_proof').map((d) => financialYearOf(d.created_at)))].sort().reverse(), [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((d) => {
      if (tab !== 'all' && (TAB_OF_CATEGORY[d.category] ?? 'other') !== tab) return false;
      if (fy !== 'all' && d.category === 'tax_proof' && financialYearOf(d.created_at) !== fy) return false;
      if (needle && !`${d.title} ${d.file_name} ${d.tax_section ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, tab, q, fy]);

  const identity = items.filter((d) => TAB_OF_CATEGORY[d.category] === 'identity');
  const verifiedIdentity = identity.filter((d) => d.status === 'verified').length;
  const taxCount = counts.tax;
  const expiring = items.filter((d) => expiryState(d.expires_on, today) !== null).length;
  const pending = items.filter((d) => d.status === 'pending').length;

  // Tax proofs by section for the chosen year: how many were filed and the amount claimed so far.
  const sections = useMemo(() => {
    const m = new Map<string, { count: number; amount: number }>();
    for (const d of items) {
      if (d.category !== 'tax_proof') continue;
      if (fy !== 'all' && financialYearOf(d.created_at) !== fy) continue;
      const key = d.tax_section?.trim() || 'Other';
      const cur = m.get(key) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += d.amount ?? 0;
      m.set(key, cur);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, fy]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Identity dossier" value={`${verifiedIdentity}/${identity.length}`} hint="ID and address proofs verified" tone={identity.length > 0 && verifiedIdentity === identity.length ? 'success' : 'primary'} />
        <StatCard label="Tax proofs" value={taxCount} hint={years[0] ? `Latest filing year ${years[0]}` : 'None filed yet'} tone="info" />
        <StatCard label="Needs attention" value={expiring + pending} hint={`${pending} awaiting review · ${expiring} expiring or expired`} tone={expiring > 0 ? 'due' : 'neutral'} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Document categories" className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {VAULT_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={chipCls(tab === t.id)}>
              {t.label} <span className="ml-1 font-mono text-[0.6875rem] opacity-80">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <a href={dossierHref} className={`rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-container-low ${items.length === 0 ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={items.length === 0}>
          Download dossier (ZIP)
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or file name" aria-label="Search documents" className={`${fieldInputCls} w-full sm:w-72`} />
        {years.length > 0 && (
          <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Financial year">
            <button type="button" onClick={() => setFy('all')} className={chipCls(fy === 'all')}>All years</button>
            {years.map((y) => <button key={y} type="button" onClick={() => setFy(y)} className={chipCls(fy === y)}>FY {y}</button>)}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className={emptyBlockCls}>{items.length === 0 ? 'No documents yet.' : 'Nothing matches that filter.'}</p>
      ) : (
        <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          {visible.map((d) => <Fragment key={d.id}>{renderRow(d)}</Fragment>)}
        </ul>
      )}

      {(tab === 'all' || tab === 'tax') && sections.length > 0 && (
        <section aria-label="Tax proofs by section" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-on-surface">Tax proofs by section{fy !== 'all' ? ` · FY ${fy}` : ''}</h3>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map(([name, v]) => (
              <li key={name} className="rounded-lg bg-surface-container-low px-3 py-2 text-xs">
                <p className="font-semibold text-on-surface">{/^\d/.test(name) ? `Section ${name}` : name}</p>
                <p className="text-on-surface-variant">{v.count} {v.count === 1 ? 'proof' : 'proofs'} · ₹{v.amount.toLocaleString('en-IN')} claimed</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
