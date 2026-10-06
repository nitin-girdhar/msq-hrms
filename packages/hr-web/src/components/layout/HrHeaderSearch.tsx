'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { hrEmployees } from '../../lib/api/client';
import PersonAvatar from '../common/PersonAvatar';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

export interface SearchPage { id: string; label: string; href: string }

interface Props {
  actor: SessionUser;
  /** The pages this person may open (the sidebar's own list, already filtered by capability on the server). */
  pages: readonly SearchPage[];
}

type Hit = { key: string; kind: 'page' | 'person'; label: string; hint?: string | undefined; href: string; userId?: string };

/**
 * Header search (Stitch top bar), Ctrl+/ from anywhere. Two kinds of result: the pages this person may open
 * (matched here, no request), and people (GET /hr/employees?search=, so the server's branch fence and
 * hr.employees.view decide who can match; this never widens it). Salary, documents and HR notes are never
 * searched. A person links to their 360 only for holders of profile360.view, otherwise to the directory.
 */
export default function HrHeaderSearch({ actor, pages }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Awaited<ReturnType<typeof hrEmployees.list>>['data']>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const mayFindPeople = can(actor, CAPABILITY.HR_EMPLOYEES_VIEW);
  const mayOpen360 = can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW);
  const term = q.trim();

  useEffect(() => {
    if (!mayFindPeople || term.length < MIN_CHARS) { setPeople([]); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(() => {
      hrEmployees.list({ search: term, limit: 6, status: 'active' })
        .then((r) => { if (id === reqId.current) { setPeople(r.data ?? []); setActive(0); } })
        .catch(() => { if (id === reqId.current) setPeople([]); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, mayFindPeople]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const needle = term.toLowerCase();
  const hits: Hit[] = term.length < MIN_CHARS ? [] : [
    ...pages.filter((p) => p.label.toLowerCase().includes(needle)).map((p): Hit => ({ key: `p-${p.id}`, kind: 'page', label: p.label, hint: 'Page', href: p.href })),
    ...people.map((p): Hit => ({
      key: `u-${p.user_id}`, kind: 'person', label: p.full_name, userId: p.user_id,
      hint: [p.designation_name, p.department_name].filter(Boolean).join(' · ') || undefined,
      href: mayOpen360 ? `/employees/${p.user_id}` : '/employees',
    })),
  ];

  const go = (h: Hit) => { setOpen(false); setQ(''); router.push(h.href); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % hits.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); }
    if (e.key === 'Enter') { e.preventDefault(); const h = hits[active]; if (h) go(h); }
  };
  const showPanel = open && term.length >= MIN_CHARS;

  return (
    <>
      <button type="button" aria-label="Search" onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container md:hidden">
        <SearchIcon />
      </button>
      <div ref={rootRef}
        className={`${open ? 'fixed inset-x-0 top-0 z-40 flex bg-surface-container-lowest p-2 shadow-overlay' : 'hidden'} md:relative md:inset-auto md:z-auto md:flex md:w-64 md:bg-transparent md:p-0 md:shadow-none lg:w-72`}>
        <div className="relative w-full">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-outline"><SearchIcon /></span>
          <input ref={inputRef} type="search" role="combobox" aria-expanded={showPanel} aria-controls="hr-search-results" aria-autocomplete="list"
            aria-label={mayFindPeople ? 'Search pages and people' : 'Search pages'} placeholder={mayFindPeople ? 'Search people or pages…' : 'Search pages…'}
            value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
            className="h-9 w-full rounded-lg bg-surface-container-low pl-8 pr-12 text-body-sm text-on-surface placeholder:text-outline focus:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <kbd className={`pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded bg-surface-container px-1.5 py-0.5 font-mono text-[0.625rem] text-outline ${q ? '' : 'md:block'}`}>Ctrl /</kbd>
          {showPanel && (
            <div id="hr-search-results" role="listbox" aria-label="Matches"
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-96 overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay md:w-96">
              {loading && hits.length === 0 && <p className="px-4 py-3 text-body-sm text-outline">Searching…</p>}
              {!loading && hits.length === 0 && <p className="px-4 py-3 text-body-sm text-on-surface-variant">Nothing matches “{term}”.</p>}
              {hits.map((h, i) => (
                <Link key={h.key} href={h.href} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => { setOpen(false); setQ(''); }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === active ? 'bg-surface-container-low' : ''}`}>
                  {h.kind === 'person' ? <PersonAvatar name={h.label} userId={h.userId} size="sm" /> : (
                    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"><SearchIcon /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label-md font-semibold text-on-surface">{h.label}</span>
                    {h.hint && <span className="block truncate text-body-sm text-on-surface-variant">{h.hint}</span>}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
        {open && <button type="button" onClick={() => setOpen(false)} className="ml-2 shrink-0 rounded-lg px-3 text-label-md text-on-surface-variant md:hidden">Cancel</button>}
      </div>
    </>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
    </svg>
  );
}
