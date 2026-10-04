'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, PageBody, PageHeader } from '@platform/ui-kit';
import { employeeViews } from '../../lib/api/client';
import type { OrgChartPerson } from '../../lib/h7/types';
import { emptyBlockCls, stateBlockCls } from '../../lib/ui';

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

function Branch({ node, depth, canOpen }: { node: Node; depth: number; canOpen: boolean }) {
  const [open, setOpen] = useState(depth < 2);
  const initials = node.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <li>
      <div className="flex items-center gap-2 py-1">
        {node.children.length > 0 ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.full_name}'s team`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-on-surface-variant hover:bg-surface-container">
            {open ? '▾' : '▸'}
          </button>
        ) : <span className="w-6 shrink-0" />}
        <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-1.5 shadow-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-xs font-bold text-on-primary-fixed" aria-hidden="true">{initials}</span>
          <div className="min-w-0">
            {canOpen ? <Link href={`/employees/${node.user_id}`} className="block truncate text-sm font-semibold text-on-surface hover:text-primary hover:underline">{node.full_name}</Link> : <p className="truncate text-sm font-semibold text-on-surface">{node.full_name}</p>}
            <p className="truncate text-label-sm text-on-surface-variant">{[node.designation_name, node.department_name].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          {node.children.length > 0 && <span className="shrink-0 rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-on-surface-variant">{node.children.length}</span>}
        </div>
      </div>
      {open && node.children.length > 0 && (
        <ul className="ml-3 border-l border-outline-variant pl-4 sm:ml-5">
          {node.children.map((c) => <Branch key={c.user_id} node={c} depth={depth + 1} canOpen={canOpen} />)}
        </ul>
      )}
    </li>
  );
}

/** Reporting-line chart of the branch (Stitch "View Org Chart"). Name, title and manager only. */
export default function OrgChartShell({ actor }: { actor: SessionUser }) {
  const [people, setPeople] = useState<OrgChartPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    employeeViews.orgChart().then((r) => setPeople(r.data)).catch((e) => { setPeople([]); setError(e instanceof Error ? e.message : 'Failed to load the org chart.'); });
  }, []);
  const roots = useMemo(() => buildTree(people ?? []), [people]);
  const canOpen = can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader title="Org chart" subtitle="Who reports to whom in this branch." />
      <PageBody>
        <Link href="/employees" className="text-xs font-semibold text-primary hover:underline">← Employees</Link>
        {error && <Alert tone="error">{error}</Alert>}
        {people === null ? <div className={stateBlockCls}>Loading…</div> : roots.length === 0 ? <p className={emptyBlockCls}>No one to show yet.</p> : (
          <ul>{roots.map((r) => <Branch key={r.user_id} node={r} depth={0} canOpen={canOpen} />)}</ul>
        )}
      </PageBody>
    </div>
  );
}
