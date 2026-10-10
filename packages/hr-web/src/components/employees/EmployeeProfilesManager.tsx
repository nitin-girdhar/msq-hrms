'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, exportRows } from '@platform/ui-kit';
import { hrEmployees, type DirectoryEnvelope } from '../../lib/api/client';
import type { EmployeeProfileView } from '../../lib/leave/types';
import { WORK_MODE_OPTIONS, optionLabel } from '../../lib/profile/types';
import { emptyBlockCls, fieldInputCls, stateBlockCls } from '../../lib/ui';
import PersonAvatar from '../common/PersonAvatar';
import StatCard from '../common/StatCard';
import StatusPill from '../common/StatusPill';
import Pagination from '../common/Pagination';

interface Props {
  /** hr.employees.profile360.view — turns each name into a link to the Employee 360 page. */
  canOpenProfile: boolean;
  /**
   * Where employee facts are edited: Admin -> Team (admin-web). Null when the actor cannot manage the
   * team (or no admin origin is configured), in which case the list is purely read-only.
   */
  teamEditUrl: string | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Status = 'active' | 'exited' | 'all';

/**
 * Workforce directory (Stitch "Employee Directory & Workforce Roster"). Search, department and status
 * are applied by the server before paging, so the totals and tab counts are the real ones for the whole
 * branch, not for the page on screen.
 *
 * READ-ONLY by design: employee facts are edited in one place, Admin -> Team, so the account and the HR
 * profile cannot disagree. Each person is filed under ONE (home) branch; people who also work in other
 * branches carry a "+N" chip next to their name.
 */
export default function EmployeeProfilesManager({ canOpenProfile, teamEditUrl }: Props) {
  const [data, setData] = useState<DirectoryEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Typing waits a beat so every keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    setLoading(true);
    hrEmployees
      .list({ page, limit: pageSize, status, ...(search ? { search } : {}), ...(dept ? { department: dept } : {}) })
      .then((res) => { setData(res); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load employee profiles.'))
      .finally(() => setLoading(false));
  }, [page, pageSize, status, search, dept]);

  useEffect(() => { load(); }, [load]);

  const profiles = data?.data ?? [];
  const meta = data?.meta;
  const total = data?.total ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  // Export what the filters describe, not just the page on screen: walk every page.
  const exportCsv = async () => {
    const all: EmployeeProfileView[] = [];
    for (let p = 1; p <= 40; p += 1) {
      const res = await hrEmployees.list({ page: p, limit: 100, status, ...(search ? { search } : {}), ...(dept ? { department: dept } : {}) });
      all.push(...res.data);
      if (all.length >= res.total) break;
    }
    exportRows(
      all,
      [
        { header: 'Name', value: (p) => p.full_name },
        { header: 'Email', value: (p) => p.email },
        { header: 'Employee code', value: (p) => p.employee_code },
        { header: 'Department', value: (p) => p.department_name },
        { header: 'Squad', value: (p) => p.squad },
        { header: 'Designation', value: (p) => p.designation_name },
        { header: 'Grade', value: (p) => p.grade },
        { header: 'Work mode', value: (p) => p.work_mode },
        { header: 'Joined', value: (p) => p.date_of_joining },
        { header: 'Last working day', value: (p) => p.date_of_exit },
        { header: 'Weekly off', value: (p) => (p.weekly_off_pattern ?? []).map((d) => WEEKDAYS[d]).join(' ') },
      ],
      `employees-${today}`,
      'csv',
    );
  };

  const nameOf = (p: EmployeeProfileView, cls: string) =>
    canOpenProfile ? (
      <Link href={`/employees/${p.user_id}`} className={`${cls} hover:text-primary hover:underline`}>{p.full_name}</Link>
    ) : (
      <span className={cls}>{p.full_name}</span>
    );

  // "+N": the other branches this person works in. Display only; their HR record stays with the home branch.
  const branchChip = (p: EmployeeProfileView) => {
    const others = p.other_branches ?? [];
    if (others.length === 0) return null;
    return (
      <span
        title={`Also works in: ${others.map((b) => b.name).join(', ')}`}
        className="ml-1.5 inline-block rounded-full bg-primary-fixed px-1.5 py-0.5 align-middle text-label-sm font-semibold text-on-primary-fixed"
      >
        +{others.length}
      </span>
    );
  };

  const notSet = (label: string) => (
    <span className="inline-block rounded-full bg-status-due-container px-2 py-0.5 text-label-sm font-semibold text-on-status-due-container">{label}</span>
  );

  const teamLink = teamEditUrl ? (
    <a href={teamEditUrl} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:border-primary hover:text-primary">
      Open in Team ↗
    </a>
  ) : null;

  const shiftCell = (p: EmployeeProfileView) =>
    p.on_leave_today ? <StatusPill tone="info">On leave</StatusPill>
    : p.shift_name ? <span><span className="font-medium text-on-surface">{p.shift_name}</span> <span className="text-label-sm tabular-nums text-on-surface-variant">{p.shift_start}–{p.shift_end}</span></span>
    : <span className="text-on-surface-variant">No shift</span>;

  const top = (meta?.departments ?? []).slice(0, 4);
  const topTotal = (meta?.departments ?? []).reduce((n, d) => n + d.count, 0);

  return (
    <div className="space-y-3">
      {error && <div role="alert" className="rounded-lg border border-status-overdue/30 bg-status-overdue-container px-4 py-2 text-xs text-on-status-overdue-container">{error}</div>}

      {meta && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Total workforce" value={meta.all} tone="primary"
            hint={`${meta.active} active · ${meta.on_leave} on leave · ${meta.exited} exited`} />
          <StatCard label="Shift allocation" value={`${meta.with_shift}`} tone="success"
            hint={`of ${meta.active} active have a shift today${meta.active > 0 ? ` (${Math.round((meta.with_shift / meta.active) * 100)}%)` : ''}`} />
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
            <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Top functions</p>
            {top.length === 0 ? <p className="mt-1 text-label-sm text-on-surface-variant">No departments set yet.</p> : (
              <>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-container" role="img" aria-label="Headcount by department">
                  {top.map((d, i) => <span key={d.name} style={{ width: `${(d.count / topTotal) * 100}%` }} className={['bg-primary', 'bg-status-success', 'bg-status-due', 'bg-status-info'][i]} />)}
                </div>
                <ul className="mt-2 space-y-0.5 text-label-sm text-on-surface-variant">
                  {top.map((d) => <li key={d.name} className="flex justify-between gap-2"><span className="truncate">{d.name}</span><span className="font-mono font-semibold text-on-surface">{d.count}</span></li>)}
                </ul>
              </>
            )}
          </div>
          <StatCard label="New cohort" value={meta.joined_this_month} tone="info" hint="joined this month" />
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or employee code" aria-label="Search employees" className={`${fieldInputCls} w-full sm:max-w-sm`} />
          <select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} aria-label="Filter by department" className={`${fieldInputCls} sm:w-56`}>
            <option value="">All departments</option>
            {(meta?.departments ?? []).map((d) => <option key={d.name} value={d.name}>{d.name} ({d.count})</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Employment status">
            {([['active', 'Active', meta?.active], ['exited', 'Exited', meta?.exited], ['all', 'All workforce', meta?.all]] as const).map(([key, label, n]) => (
              <button key={key} type="button" role="tab" aria-selected={status === key} onClick={() => { setStatus(key); setPage(1); }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${status === key ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`}>
                {label} {n !== undefined && <span className="tabular-nums opacity-80">({n})</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden gap-1 md:flex" role="group" aria-label="Layout">
              <Button variant={view === 'table' ? 'primary' : 'secondary'} onClick={() => setView('table')} aria-pressed={view === 'table'}>Table</Button>
              <Button variant={view === 'grid' ? 'primary' : 'secondary'} onClick={() => setView('grid')} aria-pressed={view === 'grid'}>Cards</Button>
            </div>
            <Button variant="secondary" onClick={() => void exportCsv()} disabled={total === 0}>Export CSV</Button>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className={stateBlockCls}>Loading…</div>
      ) : total === 0 ? (
        <p className={emptyBlockCls}>{meta && meta.all === 0 ? 'No employee profiles yet.' : 'No one matches these filters.'}</p>
      ) : (
        <div className={`rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm ${loading ? 'opacity-70' : ''}`}>
          {/* Cards: the layout below 1280px (the 6-column table needs ~900px beside the
              sidebar, which only xl provides), and the desktop one when "Cards" is chosen. */}
          <ul className={`${view === 'grid' ? 'grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-3 p-3 md:grid-cols-2 xl:hidden'}`}>
            {profiles.map((p) => (
              <li key={p.user_id} className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
                <div className="flex items-start gap-3">
                  <PersonAvatar name={p.full_name} userId={p.user_id} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{nameOf(p, 'text-sm font-semibold text-on-surface')}{branchChip(p)}</p>
                    <p className="truncate text-label-sm text-outline">{p.employee_code ?? 'No code'} · {p.email}</p>
                  </div>
                  {teamLink}
                </div>
                <p className="mt-2 text-xs text-on-surface-variant">{[p.designation_name, p.grade].filter(Boolean).join(' · ') || notSet('Designation not set')}</p>
                <p className="mt-1 text-xs text-on-surface-variant">{[p.department_name, p.squad].filter(Boolean).join(' · ') || notSet('Department not set')}</p>
                <p className="mt-1 text-xs">{shiftCell(p)}</p>
              </li>
            ))}
          </ul>

          <div className={`${view === 'grid' ? 'hidden' : 'hidden xl:block'} overflow-x-auto`}>
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  <th className="px-4 py-3">Employee &amp; ID</th>
                  <th className="px-4 py-3">Designation &amp; level</th>
                  <th className="px-4 py-3">Department &amp; squad</th>
                  <th className="px-4 py-3">Today&apos;s shift</th>
                  <th className="px-4 py-3">Work mode</th>
                  {teamEditUrl && <th className="sticky right-0 bg-surface-container-low px-4 py-3 text-right">Manage</th>}
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.user_id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <PersonAvatar name={p.full_name} userId={p.user_id} size="md" />
                        <div className="min-w-0">
                          <p className="truncate">{nameOf(p, 'font-semibold text-on-surface')}{branchChip(p)}</p>
                          <p className="truncate font-mono text-label-sm text-outline">{p.employee_code ?? 'No code'} · {p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-on-surface">{p.designation_name ?? notSet('Not set')}</p>
                      {p.grade && <span className="mt-0.5 inline-block rounded bg-primary-fixed px-1.5 py-0.5 text-label-sm font-semibold text-on-primary-fixed">{p.grade}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-on-surface">{p.department_name ?? notSet('Not set')}</p>
                      {p.squad && <p className="text-label-sm text-on-surface-variant">{p.squad}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs">{shiftCell(p)}</td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant">{p.work_mode ? optionLabel(WORK_MODE_OPTIONS, p.work_mode) : '—'}</td>
                    {teamEditUrl && <td className="sticky right-0 bg-surface-container-lowest px-4 py-3 text-right">{teamLink}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="employees" />
        </div>
      )}
    </div>
  );
}
