'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, Button, PageBody, PageHeader, useIsMobile } from '@platform/ui-kit';
import { useTerm } from '@platform/ui-kit/branding';
import { employeeViews } from '../../lib/api/client';
import type { OrgChartPerson } from '../../lib/h7/types';
import { emptyBlockCls, fieldInputCls, stateBlockCls } from '../../lib/ui';
import PersonAvatar from '../common/PersonAvatar';
import StatCard from '../common/StatCard';

interface Node extends OrgChartPerson { children: Node[] }

/** Build the reporting tree. Anyone whose manager is not in this branch (or who has none) is a root. */
export function buildTree(people: OrgChartPerson[]): Node[] {
  const byId = new Map<string, Node>(people.map((p) => [p.user_id, { ...p, children: [] }]));
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const parent = n.manager_id ? byId.get(n.manager_id) : undefined;
    // A manager cycle (A reports to B, B to A) would hang the render; treat the second link as a root.
    if (parent && !isAncestor(byId, n.user_id, parent)) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function isAncestor(byId: Map<string, Node>, candidate: string, from: Node): boolean {
  const seen = new Set<string>();
  for (let cur: Node | undefined = from; cur && !seen.has(cur.user_id); cur = cur.manager_id ? byId.get(cur.manager_id) : undefined) {
    if (cur.user_id === candidate) return true;
    seen.add(cur.user_id);
  }
  return false;
}

/** A node as drawn: `match` is false for an ancestor kept only so a filtered branch stays connected. */
interface ViewNode { node: Node; kids: ViewNode[]; match: boolean }

function prune(node: Node, keep: (n: Node) => boolean): ViewNode | null {
  const kids = node.children.map((c) => prune(c, keep)).filter((k): k is ViewNode => k !== null);
  const match = keep(node);
  return match || kids.length > 0 ? { node, kids, match } : null;
}

function measure(roots: Node[]): { count: number; levels: number; widest: number } {
  let count = 0;
  let levels = 0;
  let widest = 0;
  const walk = (n: Node, depth: number) => {
    count += 1;
    levels = Math.max(levels, depth);
    widest = Math.max(widest, n.children.length);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((r) => walk(r, 1));
  return { count, levels, widest };
}

interface Ctx {
  canOpen: boolean;
  focusId: string | null;
  isOpen: (id: string, depth: number) => boolean;
  toggle: (id: string, depth: number) => void;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? '' : '-rotate-90'}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ToggleButton({ v, open, onClick, big }: { v: ViewNode; open: boolean; onClick: () => void; big?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${v.node.full_name}'s team`}
      className={`flex shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container ${big ? 'h-11 w-11' : 'h-8 w-8'}`}
    >
      <Chevron open={open} />
    </button>
  );
}

function PersonName({ node, canOpen }: { node: Node; canOpen: boolean }) {
  return canOpen
    ? <Link href={`/employees/${node.user_id}`} className="block truncate text-sm font-semibold text-on-surface hover:text-primary hover:underline">{node.full_name}</Link>
    : <p className="truncate text-sm font-semibold text-on-surface">{node.full_name}</p>;
}

/** One card of the top-down chart (desktop), with the connector lines to its parent and children. */
function ChartNode({ v, depth, pos, ctx }: { v: ViewNode; depth: number; pos: 'root' | 'only' | 'first' | 'middle' | 'last'; ctx: Ctx }) {
  const { node } = v;
  const reports = node.children.length;
  const open = ctx.isOpen(node.user_id, depth);
  const focused = ctx.focusId === node.user_id;
  return (
    <li className={`relative flex flex-col items-center px-2 ${pos === 'root' ? '' : 'pt-6'}`}>
      {pos !== 'root' && <span className="absolute left-1/2 top-0 h-6 w-px bg-outline-variant" aria-hidden="true" />}
      {(pos === 'first' || pos === 'middle' || pos === 'last') && (
        <span
          className={`absolute top-0 h-px bg-outline-variant ${pos === 'first' ? 'left-1/2 right-0' : pos === 'last' ? 'left-0 right-1/2' : 'left-0 right-0'}`}
          aria-hidden="true"
        />
      )}
      <div
        id={`org-node-${node.user_id}`}
        className={`w-60 rounded-xl border bg-surface-container-lowest p-3 shadow-sm ${focused ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant'} ${v.match ? '' : 'opacity-60'}`}
      >
        {node.department_name && <span className="mb-2 inline-block max-w-full truncate rounded bg-primary-fixed px-1.5 py-0.5 text-label-sm font-semibold uppercase tracking-wide text-on-primary-fixed">{node.department_name}</span>}
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={node.full_name} userId={node.user_id} size="md" />
          <div className="min-w-0">
            <PersonName node={node} canOpen={ctx.canOpen} />
            <p className="truncate text-label-sm text-on-surface-variant">{node.designation_name ?? '—'}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-outline-variant pt-2">
          <p className="text-label-sm text-on-surface-variant">
            Direct reports <span className="ml-1 rounded-full bg-surface-container px-2 py-0.5 font-mono font-semibold text-on-surface">{reports}</span>
          </p>
          {v.kids.length > 0 && <ToggleButton v={v} open={open} onClick={() => ctx.toggle(node.user_id, depth)} />}
        </div>
      </div>
      {open && v.kids.length > 0 && (
        <>
          <span className="h-6 w-px bg-outline-variant" aria-hidden="true" />
          <ul className="flex items-start justify-center">
            {v.kids.map((k, i) => (
              <ChartNode key={k.node.user_id} v={k} depth={depth + 1} ctx={ctx}
                pos={v.kids.length === 1 ? 'only' : i === 0 ? 'first' : i === v.kids.length - 1 ? 'last' : 'middle'} />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

/** Phone layout: the same tree as an indented list, one tappable row per person. */
function ListNode({ v, depth, ctx }: { v: ViewNode; depth: number; ctx: Ctx }) {
  const { node } = v;
  const open = ctx.isOpen(node.user_id, depth);
  const focused = ctx.focusId === node.user_id;
  return (
    <li>
      <div
        id={`org-node-${node.user_id}`}
        className={`flex items-center gap-3 rounded-xl border bg-surface-container-lowest p-3 shadow-sm ${focused ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant'} ${v.match ? '' : 'opacity-60'}`}
      >
        <PersonAvatar name={node.full_name} userId={node.user_id} size="md" />
        <div className="min-w-0 flex-1">
          {ctx.canOpen
            ? <Link href={`/employees/${node.user_id}`} className="flex min-h-11 flex-col justify-center hover:text-primary"><span className="truncate text-sm font-semibold text-on-surface">{node.full_name}</span><span className="truncate text-label-sm text-on-surface-variant">{[node.designation_name, node.department_name].filter(Boolean).join(' · ') || '—'}</span></Link>
            : <div className="flex min-h-11 flex-col justify-center"><span className="truncate text-sm font-semibold text-on-surface">{node.full_name}</span><span className="truncate text-label-sm text-on-surface-variant">{[node.designation_name, node.department_name].filter(Boolean).join(' · ') || '—'}</span></div>}
        </div>
        {node.children.length > 0 && <span className="shrink-0 rounded-full bg-surface-container px-2 py-0.5 font-mono text-label-sm font-semibold text-on-surface-variant" title="Direct reports">{node.children.length}</span>}
        {v.kids.length > 0 && <ToggleButton v={v} open={open} onClick={() => ctx.toggle(node.user_id, depth)} big />}
      </div>
      {open && v.kids.length > 0 && (
        <ul className="ml-5 mt-2 space-y-2 border-l-2 border-outline-variant pl-3">
          {v.kids.map((k) => <ListNode key={k.node.user_id} v={k} depth={depth + 1} ctx={ctx} />)}
        </ul>
      )}
    </li>
  );
}

/** Reporting-line chart of the branch (Stitch "View Org Chart"). Name, title and manager only. */
export default function OrgChartShell({ actor }: { actor: SessionUser }) {
  const term = useTerm();
  const mobile = useIsMobile(767);
  const [people, setPeople] = useState<OrgChartPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dept, setDept] = useState('');
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  // Explicit open/closed choices; anything not listed follows the default (first two levels open).
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    employeeViews.orgChart().then((r) => setPeople(r.data)).catch((e) => { setPeople([]); setError(e instanceof Error ? e.message : 'Failed to load the org chart.'); });
  }, []);

  const roots = useMemo(() => buildTree(people ?? []), [people]);
  const stats = useMemo(() => measure(roots), [roots]);
  const parentOf = useMemo(() => new Map((people ?? []).map((p) => [p.user_id, p.manager_id])), [people]);
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people ?? []) if (p.department_name) counts.set(p.department_name, (counts.get(p.department_name) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [people]);

  const view = useMemo(
    () => roots.map((r) => prune(r, (n) => !dept || n.department_name === dept)).filter((v): v is ViewNode => v !== null),
    [roots, dept],
  );
  const canOpen = can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW);

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () => (q ? (people ?? []).filter((p) => [p.full_name, p.designation_name, p.department_name].some((s) => s?.toLowerCase().includes(q))).slice(0, 6) : []),
    [people, q],
  );

  // A filtered chart is shown fully open so every match is visible.
  const isOpen = (id: string, depth: number) => (dept ? true : (overrides.get(id) ?? depth < 2));
  const toggle = (id: string, depth: number) => setOverrides((m) => new Map(m).set(id, !(m.get(id) ?? depth < 2)));
  const ctx: Ctx = { canOpen, focusId, isOpen, toggle };

  const setAll = (open: boolean) => {
    const next = new Map<string, boolean>();
    const walk = (n: Node) => { if (n.children.length) next.set(n.user_id, open); n.children.forEach(walk); };
    roots.forEach(walk);
    setOverrides(next);
  };

  const focusPerson = (id: string) => {
    // Clear the department filter if it would hide this person, then open every ancestor.
    const person = (people ?? []).find((p) => p.user_id === id);
    if (dept && person?.department_name !== dept) setDept('');
    setOverrides((m) => {
      const next = new Map(m);
      const seen = new Set<string>();
      for (let cur = parentOf.get(id); cur && !seen.has(cur); cur = parentOf.get(cur)) { seen.add(cur); next.set(cur, true); }
      return next;
    });
    setFocusId(id);
    setQuery('');
  };

  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => document.getElementById(`org-node-${focusId}`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }), 50);
    return () => clearTimeout(t);
  }, [focusId]);

  const branch = term('branch', 'branch');

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader title="Org chart" info={`Who reports to whom in this ${branch}.`} />
      <PageBody dense>
        <Link href="/employees" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline sm:min-h-0">← Employees</Link>
        {error && <Alert tone="error">{error}</Alert>}

        {people !== null && people.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Headcount" value={stats.count} />
            <StatCard label="Levels" value={stats.levels} tone="info" />
            <StatCard label="Widest team" value={stats.widest} tone="neutral" hint="direct reports" />
          </div>
        )}

        {people !== null && people.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
            <div className="relative min-w-0 flex-1 basis-60">
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) focusPerson(results[0].user_id); if (e.key === 'Escape') setQuery(''); }}
                placeholder={`Search a person in this ${branch}`} aria-label="Search people"
                className={`${fieldInputCls} h-11 w-full sm:h-10`}
              />
              {q && (
                <ul role="listbox" aria-label="Matching people" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-1 shadow-lg">
                  {results.length === 0 ? <li className="px-3 py-2 text-sm text-on-surface-variant">No one matches.</li> : results.map((p) => (
                    <li key={p.user_id} role="option" aria-selected={false}>
                      <button type="button" onClick={() => focusPerson(p.user_id)} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-surface-container">
                        <PersonAvatar name={p.full_name} userId={p.user_id} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-on-surface">{p.full_name}</span>
                          <span className="block truncate text-label-sm text-on-surface-variant">{[p.designation_name, p.department_name].filter(Boolean).join(' · ') || '—'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" className={`${fieldInputCls} h-11 sm:h-10`}>
              <option value="">All departments ({departments.length})</option>
              {departments.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
            </select>
            <div className="flex gap-2">
              <Button onClick={() => setAll(true)} disabled={!!dept} className="max-lg:min-h-11">Expand all</Button>
              <Button onClick={() => setAll(false)} disabled={!!dept} className="max-lg:min-h-11">Collapse all</Button>
            </div>
          </div>
        )}

        {people === null ? <div className={stateBlockCls}>Loading…</div> : view.length === 0 ? <p className={emptyBlockCls}>{people.length === 0 ? 'No one to show yet.' : 'No one in that department.'}</p> : mobile ? (
          <ul className="space-y-2">{view.map((v) => <ListNode key={v.node.user_id} v={v} depth={0} ctx={ctx} />)}</ul>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-low p-6">
            <ul className="mx-auto flex w-max items-start gap-6">
              {view.map((v) => <ChartNode key={v.node.user_id} v={v} depth={0} pos="root" ctx={ctx} />)}
            </ul>
          </div>
        )}
      </PageBody>
    </div>
  );
}
