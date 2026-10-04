'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Modal, exportRows } from '@platform/ui-kit';
import { hrEmployees } from '../../lib/api/client';
import type { EmployeeProfileView, HrLookupOption } from '../../lib/leave/types';
import { WORK_MODE_OPTIONS } from '../../lib/profile/types';
import { emptyBlockCls, fieldInputCls, stateBlockCls } from '../../lib/ui';

interface Props {
  onNotice: (msg: string) => void;
  /** hr.employees.manage — without it the list is read-only (no Edit column). */
  canManage: boolean;
  /** hr.employees.profile360.view — turns each name into a link to the Employee 360 page. */
  canOpenProfile: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function EmployeeProfilesManager({ onNotice, canManage, canOpenProfile }: Props) {
  const [profiles, setProfiles] = useState<EmployeeProfileView[]>([]);
  const [departments, setDepartments] = useState<HrLookupOption[]>([]);
  const [designations, setDesignations] = useState<HrLookupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmployeeProfileView | null>(null);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState<'active' | 'exited' | 'all'>('active');
  const [view, setView] = useState<'table' | 'grid'>('table');

  const loadLookups = useCallback(() => {
    Promise.all([hrEmployees.departments.list(), hrEmployees.designations.list()])
      .then(([d, ds]) => { setDepartments(d.data); setDesignations(ds.data); })
      .catch(() => { /* lookups optional */ });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    hrEmployees
      .list()
      .then((res) => setProfiles(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load employee profiles.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); loadLookups(); }, [load, loadLookups]);

  // Department options come from the people actually listed, not the lookup, so
  // the filter never offers a department with nobody in it.
  const deptOptions = useMemo(
    () => Array.from(new Set(profiles.map((p) => p.department_name).filter((d): d is string => !!d))).sort(),
    [profiles],
  );

  // Exited = a last working day on or before today. Someone with a FUTURE exit date is still active.
  const today = new Date().toISOString().slice(0, 10);
  const isExited = (p: EmployeeProfileView) => !!p.date_of_exit && p.date_of_exit <= today;
  const counts = useMemo(
    () => ({ active: profiles.filter((p) => !isExited(p)).length, exited: profiles.filter(isExited).length, all: profiles.length }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profiles, today],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter(
      (p) =>
        (status === 'all' || (status === 'exited') === isExited(p)) &&
        (!dept || p.department_name === dept) &&
        (!q || [p.full_name, p.email, p.employee_code].some((v) => v?.toLowerCase().includes(q))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, query, dept, status, today]);

  const exportCsv = () =>
    exportRows(
      visible,
      [
        { header: 'Name', value: (p) => p.full_name },
        { header: 'Email', value: (p) => p.email },
        { header: 'Employee code', value: (p) => p.employee_code },
        { header: 'Department', value: (p) => p.department_name },
        { header: 'Designation', value: (p) => p.designation_name },
        { header: 'Joined', value: (p) => p.date_of_joining },
        { header: 'Last working day', value: (p) => p.date_of_exit },
        { header: 'Weekly off', value: (p) => (p.weekly_off_pattern ?? []).map((d) => WEEKDAYS[d]).join(' ') },
      ],
      `employees-${today}`,
      'csv',
    );

  const thisMonth = new Date().toISOString().slice(0, 7);
  const joinedThisMonth = profiles.filter((p) => p.date_of_joining?.startsWith(thisMonth)).length;

  const nameOf = (p: EmployeeProfileView, cls: string) =>
    canOpenProfile ? (
      <Link href={`/employees/${p.user_id}`} className={`${cls} hover:text-primary hover:underline`}>{p.full_name}</Link>
    ) : (
      <span className={cls}>{p.full_name}</span>
    );

  const editButton = (p: EmployeeProfileView) =>
    canManage ? (
      <button type="button" onClick={() => setEditing(p)} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:border-primary hover:text-primary">
        Edit
      </button>
    ) : null;

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg border border-status-overdue/30 bg-status-overdue-container px-4 py-2 text-xs text-on-status-overdue-container">{error}</div>}

      {loading ? (
        <div className={stateBlockCls}>Loading…</div>
      ) : profiles.length === 0 ? (
        <p className={emptyBlockCls}>No employee profiles yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Employees" value={profiles.length} />
            <Tile label="Departments" value={deptOptions.length} />
            <Tile label="Joined this month" value={joinedThisMonth} />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or employee code"
              aria-label="Search employees"
              className={`${fieldInputCls} w-full sm:max-w-sm`}
            />
            <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department" className={`${fieldInputCls} sm:w-56`}>
              <option value="">All departments</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Employment status">
              {([['active', 'Active'], ['exited', 'Exited'], ['all', 'All']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={status === key} onClick={() => setStatus(key)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${status === key ? 'border-primary bg-primary-fixed text-on-primary-fixed' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`}>
                  {label} <span className="tabular-nums opacity-70">{counts[key]}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden gap-1 md:flex" role="group" aria-label="Layout">
                <Button variant={view === 'table' ? 'primary' : 'secondary'} onClick={() => setView('table')} aria-pressed={view === 'table'}>Table</Button>
                <Button variant={view === 'grid' ? 'primary' : 'secondary'} onClick={() => setView('grid')} aria-pressed={view === 'grid'}>Cards</Button>
              </div>
              <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>Export CSV</Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className={emptyBlockCls}>No one matches these filters.</p>
          ) : (
            <>
              {/* Cards: the phone layout, and the desktop one when "Cards" is chosen. */}
              <ul className={`${view === 'grid' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-2 md:hidden'}`}>
                {visible.map((p) => (
                  <li key={p.user_id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate">{nameOf(p, 'text-sm font-semibold text-on-surface')}</p>
                        <p className="truncate text-label-sm text-outline">{p.email}</p>
                      </div>
                      {editButton(p)}
                    </div>
                    <p className="mt-2 text-xs text-on-surface-variant">
                      {[p.designation_name, p.department_name].filter(Boolean).join(' · ') || '—'}
                    </p>
                    <p className="text-label-sm text-outline">
                      {p.employee_code ?? 'No code'} · Joined {p.date_of_joining ?? '—'}
                    </p>
                  </li>
                ))}
              </ul>

              <div className={`${view === 'grid' ? 'hidden' : 'hidden md:block'} overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm`}>
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Joined</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Designation</th>
                      <th className="px-4 py-3">Weekly off</th>
                      {canManage && <th className="px-4 py-3 text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.user_id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                        <td className="px-4 py-3">
                          <p>{nameOf(p, 'font-medium text-on-surface')}</p>
                          <p className="text-label-sm text-outline">{p.email}</p>
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant">{p.employee_code ?? '—'}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{p.date_of_joining ?? '—'}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{p.department_name ?? '—'}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{p.designation_name ?? '—'}</td>
                        <td className="px-4 py-3 text-label-sm text-on-surface-variant">
                          {(p.weekly_off_pattern ?? []).map((d) => WEEKDAYS[d]).join(', ') || '—'}
                        </td>
                        {canManage && <td className="px-4 py-3 text-right">{editButton(p)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {canManage && editing && (
        <EmployeeEditModal
          profile={editing}
          departments={departments}
          designations={designations}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { onNotice(msg); load(); loadLookups(); }}
        />
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm sm:p-4">
      <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="mt-1 font-mono text-headline-md font-bold tabular-nums text-on-surface">{value}</p>
    </div>
  );
}

interface EditProps {
  profile: EmployeeProfileView;
  departments: HrLookupOption[];
  designations: HrLookupOption[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}

function EmployeeEditModal({ profile, departments, designations, onClose, onSaved }: EditProps) {
  const [joining, setJoining] = useState(profile.date_of_joining ?? '');
  const [code, setCode] = useState(profile.employee_code ?? '');
  const [department, setDepartment] = useState(profile.department_name ?? '');
  const [designation, setDesignation] = useState(profile.designation_name ?? '');
  const [weeklyOff, setWeeklyOff] = useState<number[]>(profile.weekly_off_pattern ?? [0, 6]);
  const [grade, setGrade] = useState(profile.grade ?? '');
  const [squad, setSquad] = useState(profile.squad ?? '');
  const [costCenter, setCostCenter] = useState(profile.cost_center ?? '');
  const [notice, setNotice] = useState(profile.notice_period_days != null ? String(profile.notice_period_days) : '');
  const [workMode, setWorkMode] = useState<string>(profile.work_mode ?? '');
  const [seat, setSeat] = useState(profile.seat_label ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) => {
    setWeeklyOff((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const save = async () => {
    setError(null);
    if (!joining) { setError('Joining date is required.'); return; }
    const noticeDays = notice.trim() === '' ? null : Number(notice);
    if (noticeDays !== null && (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365)) { setError('Notice period is a whole number of days, 0 to 365.'); return; }
    setSubmitting(true);
    try {
      await hrEmployees.update(profile.user_id, {
        date_of_joining: joining,
        employee_code: code.trim() || undefined,
        department_name: department.trim() || undefined,
        designation_name: designation.trim() || undefined,
        weekly_off_pattern: weeklyOff,
        // Empty clears the value (null), unlike the fields above.
        grade: grade.trim() || null,
        squad: squad.trim() || null,
        cost_center: costCenter.trim() || null,
        notice_period_days: noticeDays,
        work_mode: (workMode || null) as 'office' | 'hybrid' | 'remote' | null,
        seat_label: seat.trim() || null,
      });
      onSaved('Employee profile updated.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
  const labelCls = 'text-xs font-semibold text-on-surface';

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">Cancel</button>
      <button type="button" onClick={save} disabled={submitting} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60">
        {submitting ? 'Saving…' : 'Save profile'}
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`Edit — ${profile.full_name}`} locked={submitting} maxWidth="max-w-lg" footer={footer}>
      <div className="flex flex-col gap-4">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-join" className={labelCls}>Joining date *</label>
            <input id="ee-join" type="date" value={joining} onChange={(e) => setJoining(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-code" className={labelCls}>Employee code</label>
            <input id="ee-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-dept" className={labelCls}>Department</label>
            <input id="ee-dept" list="ee-dept-list" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={submitting} className={inputCls} />
            <datalist id="ee-dept-list">{departments.map((d) => <option key={d.id} value={d.name} />)}</datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-desig" className={labelCls}>Designation</label>
            <input id="ee-desig" list="ee-desig-list" value={designation} onChange={(e) => setDesignation(e.target.value)} disabled={submitting} className={inputCls} />
            <datalist id="ee-desig-list">{designations.map((d) => <option key={d.id} value={d.name} />)}</datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-grade" className={labelCls}>Grade / level</label>
            <input id="ee-grade" value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={40} placeholder="e.g. L4" disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-squad" className={labelCls}>Squad</label>
            <input id="ee-squad" value={squad} onChange={(e) => setSquad(e.target.value)} maxLength={100} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-cc" className={labelCls}>Cost centre</label>
            <input id="ee-cc" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} maxLength={60} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-notice" className={labelCls}>Notice period (days)</label>
            <input id="ee-notice" inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-mode" className={labelCls}>Work mode</label>
            <select id="ee-mode" value={workMode} onChange={(e) => setWorkMode(e.target.value)} disabled={submitting} className={inputCls}>
              <option value="">—</option>
              {WORK_MODE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-seat" className={labelCls}>Seat</label>
            <input id="ee-seat" value={seat} onChange={(e) => setSeat(e.target.value)} maxLength={60} placeholder="e.g. Floor 4, Desk 412" disabled={submitting} className={inputCls} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Weekly off</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w, d) => (
              <label key={w} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${weeklyOff.includes(d) ? 'border-primary bg-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant'}`}>
                <input type="checkbox" checked={weeklyOff.includes(d)} onChange={() => toggleDay(d)} disabled={submitting} className="h-3.5 w-3.5" />
                {w}
              </label>
            ))}
          </div>
        </div>

      </div>
    </Modal>
  );
}
