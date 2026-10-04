'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, PageBody, PageHeader } from '@platform/ui-kit';
import { planner } from '../../lib/api/client';
import {
  SHIFT_STYLE,
  addDaysIso,
  type ApplyShiftsOutcome,
  type PlannerPerson,
  type PlannerShift,
  type PlannerWeek,
} from '../../lib/planner/types';
import { formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

const todayIso = () => new Date().toISOString().slice(0, 10);
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const monthShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const NON_SHIFT = {
  off: ['Weekly off', 'bg-surface-container text-on-surface-variant'],
  holiday: ['Holiday', 'bg-cat-purple-container text-on-cat-purple-container'],
  leave: ['On leave', 'bg-status-info-container text-on-status-info-container'],
} as const;

type Edit = { person: PlannerPerson; date: string };

/**
 * Roster planner (Stitch "Workforce Shift Roster & Schedule Planner", part 1). HR lays out who works
 * which shift: click a cell to change one day, tick people and "Assign shift pattern" to set a shift
 * over a date range, set how many people each shift needs, and publish the week. Part 2 adds the
 * swap and weekly-off desk, the capacity chart, bulk reallocation, day/month views and notifying
 * people on publish.
 */
export default function PlannerShell() {
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [week, setWeek] = useState<PlannerWeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<ApplyShiftsOutcome['skipped']>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Edit | null>(null);
  const [pattern, setPattern] = useState(false);
  const [needs, setNeeds] = useState<PlannerShift | null>(null);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(() => {
    planner
      .week({ ...(from ? { from } : {}), ...(query.trim() ? { q: query.trim() } : {}) })
      .then((r) => { setWeek(r.data); setError(null); })
      .catch((e) => { setWeek(null); setError(e instanceof Error ? e.message : 'Failed to load the planner.'); });
  }, [from, query]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const shiftStyle = useMemo(() => {
    const idx = new Map((week?.shifts ?? []).map((s, i) => [s.id, i]));
    return (id: string) => SHIFT_STYLE[(idx.get(id) ?? 0) % SHIFT_STYLE.length]!;
  }, [week]);
  const shiftById = useMemo(() => new Map((week?.shifts ?? []).map((s) => [s.id, s])), [week]);

  const today = todayIso();
  const dates = week ? Array.from({ length: 7 }, (_, i) => addDaysIso(week.week_start, i)) : [];
  // The day the capacity cards describe: today when it is in this week, otherwise Monday.
  const focusIdx = week && today >= week.week_start && today <= week.week_end ? dates.indexOf(today) : 0;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShown = week ? week.people.length > 0 && week.people.every((p) => selected.has(p.user_id)) : false;

  const afterApply = (o: ApplyShiftsOutcome) => {
    setSkipped(o.skipped);
    setNotice(o.applied > 0 ? `Updated ${o.applied} ${o.applied === 1 ? 'person' : 'people'}.` : null);
    if (o.applied === 0 && o.skipped.length === 0) setNotice('Nothing needed to change.');
    load();
  };

  const exportCsv = () => {
    if (!week) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ['Name', 'Code', ...dates.map((d) => `${DOW[dates.indexOf(d)]} ${d}`)];
    const rows = week.people.map((p) => [
      p.full_name, p.employee_code ?? '',
      ...p.days.map((d) => (d.kind === 'shift' ? (shiftById.get(d.shift_id!)?.name ?? '') : d.kind === 'off' || d.kind === 'holiday' || d.kind === 'leave' ? NON_SHIFT[d.kind][0] : '')),
    ]);
    const csv = [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `roster-${week.week_start}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Roster planner"
        subtitle="Plan who works which shift. Click a day to change it; tick people to set a shift for a date range."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!week || week.people.length === 0}>Export</Button>
            <Button variant="secondary" onClick={() => setPattern(true)} disabled={selected.size === 0}>Assign shift pattern{selected.size ? ` (${selected.size})` : ''}</Button>
            <Button variant="primary" onClick={() => setPublishing(true)} disabled={!week}>Publish roster</Button>
          </>
        }
      />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {skipped.length > 0 && (
          <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-4 py-3 text-sm text-on-status-due-container">
            <p className="font-semibold">{skipped.length} {skipped.length === 1 ? 'person was' : 'people were'} not changed:</p>
            <ul className="mt-1 list-disc pl-5">{skipped.map((s) => <li key={s.user_id}>{s.full_name} - {s.reason}</li>)}</ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
          <div className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-low px-1 py-1">
            <button type="button" aria-label="Previous week" onClick={() => week && setFrom(addDaysIso(week.week_start, -7))} className="rounded px-2 py-1 text-on-surface-variant hover:bg-surface-container">‹</button>
            <span className="min-w-44 text-center text-sm font-semibold text-on-surface">{week ? `${monthShort(week.week_start)} – ${monthShort(week.week_end)} ${week.week_end.slice(0, 4)}` : '…'}</span>
            <button type="button" aria-label="Next week" onClick={() => week && setFrom(addDaysIso(week.week_start, 7))} className="rounded px-2 py-1 text-on-surface-variant hover:bg-surface-container">›</button>
          </div>
          <Button variant="secondary" onClick={() => setFrom(undefined)}>Today</Button>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or code" aria-label="Search people" className={`${fieldInputCls} w-64`} />
          {week && (
            <span className={`ml-auto rounded-full px-3 py-1 text-label-sm font-semibold ${week.published ? (week.changes_since_publish > 0 ? 'bg-status-due-container text-on-status-due-container' : 'bg-status-success-container text-on-status-success-container') : 'bg-surface-container text-on-surface-variant'}`}>
              {week.published
                ? `Published ${formatDateTime(week.published.published_at)}${week.published.published_by_name ? ` by ${week.published.published_by_name}` : ''}${week.changes_since_publish > 0 ? ` · ${week.changes_since_publish} change${week.changes_since_publish === 1 ? '' : 's'} since` : ''}`
                : 'Not published yet'}
            </span>
          )}
        </div>

        {!week ? <div className={stateBlockCls}>{error ? '' : 'Loading…'}</div> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
                <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Headcount pool</p>
                <p className="mt-1 font-mono text-headline-lg font-bold tabular-nums text-on-surface">{week.headcount}</p>
                <p className="text-label-sm text-on-surface-variant">
                  {Object.values(week.assigned).reduce((n, d) => n + (d[focusIdx] ?? 0), 0)} on a shift {dates[focusIdx] === today ? 'today' : `on ${monthShort(dates[focusIdx]!)}`}
                </p>
              </div>
              {week.shifts.map((s) => {
                const have = week.assigned[s.id]?.[focusIdx] ?? 0;
                const pct = s.required ? Math.min(100, Math.round((have / s.required) * 100)) : 0;
                const state = s.required === null ? null : have < s.required ? 'Short' : have === s.required ? 'Full' : 'Over';
                return (
                  <button key={s.id} type="button" onClick={() => setNeeds(s)} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-left shadow-sm transition-colors hover:border-primary">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: shiftStyle(s.id).dot }} aria-hidden="true" />{s.name}
                      </p>
                      {state && <span className={`rounded-full px-2 py-0.5 text-label-sm font-semibold ${state === 'Short' ? 'bg-status-overdue-container text-on-status-overdue-container' : state === 'Full' ? 'bg-status-success-container text-on-status-success-container' : 'bg-status-due-container text-on-status-due-container'}`}>{state}</span>}
                    </div>
                    <p className="mt-1 font-mono text-headline-lg font-bold tabular-nums text-on-surface">
                      {have}<span className="text-base font-medium text-on-surface-variant"> / {s.required ?? '—'}</span>
                    </p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container" aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: shiftStyle(s.id).dot }} /></div>
                    <p className="mt-1 text-label-sm text-on-surface-variant">{s.start}–{s.end}{s.required === null ? ' · click to set the number needed' : ''}</p>
                  </button>
                );
              })}
            </div>

            {week.shifts.length === 0 && <p className={emptyBlockCls}>No shifts are defined for this branch yet. Add them under Attendance admin → Shifts, then plan them here.</p>}

            <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
              <table className="w-full min-w-[56rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-sm uppercase tracking-wide text-on-surface-variant">
                    <th className="w-72 px-3 py-2">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={allShown} onChange={() => setSelected(allShown ? new Set() : new Set(week.people.map((p) => p.user_id)))} aria-label="Select everyone shown" />
                        Staff
                      </label>
                    </th>
                    {dates.map((d, i) => (
                      <th key={d} className={`px-2 py-2 text-center ${d === today ? 'bg-primary-fixed text-on-primary-fixed' : ''}`}>
                        {DOW[i]} <span className="block font-mono text-sm normal-case text-on-surface">{dayNum(d)}</span>
                        {d === today && <span className="text-[10px] normal-case">Today</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {week.people.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-on-surface-variant">No one matches.</td></tr>
                  )}
                  {week.people.map((p) => (
                    <tr key={p.user_id} className="border-b border-outline-variant/50 last:border-0">
                      <td className="px-3 py-1.5">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={selected.has(p.user_id)} onChange={() => toggle(p.user_id)} aria-label={`Select ${p.full_name}`} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-on-surface">{p.full_name}</span>
                            <span className="block truncate text-label-sm text-on-surface-variant">{[p.employee_code, p.designation_name].filter(Boolean).join(' · ') || '—'}</span>
                          </span>
                        </label>
                      </td>
                      {p.days.map((d) => {
                        const editable = d.date >= today;
                        const s = d.shift_id ? shiftById.get(d.shift_id) : null;
                        return (
                          <td key={d.date} className={`px-1 py-1 text-center ${d.date === today ? 'bg-primary-fixed/30' : ''}`}>
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() => setEdit({ person: p, date: d.date })}
                              title={editable ? 'Change this day' : 'Past days are already resolved into attendance'}
                              className="w-full rounded-lg px-1 py-1 text-label-sm transition-opacity enabled:hover:ring-2 enabled:hover:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {d.kind === 'shift' && s ? (
                                <span className={`block rounded-lg px-1.5 py-1 ${shiftStyle(s.id).chip}`}>
                                  <span className="block truncate font-semibold">{s.name}</span>
                                  <span className="block tabular-nums opacity-80">{s.start}–{s.end}</span>
                                </span>
                              ) : d.kind === 'off' || d.kind === 'holiday' || d.kind === 'leave' ? (
                                <span className={`block rounded-lg px-1.5 py-1.5 font-medium ${NON_SHIFT[d.kind][1]}`}>{NON_SHIFT[d.kind][0]}</span>
                              ) : (
                                <span className="block rounded-lg border border-dashed border-outline-variant px-1.5 py-1.5 text-outline">+ Assign</span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-label-sm text-on-surface-variant">
              A shift set on a weekly off or holiday is kept but shows as off. Every change is checked against the 11-hour rest rule and recorded in the audit log.
            </p>
          </>
        )}
      </PageBody>

      {edit && week && (
        <CellModal
          edit={edit} week={week} shiftStyle={shiftStyle}
          onClose={() => setEdit(null)}
          onDone={(o) => { setEdit(null); afterApply(o); }}
          onError={setError}
        />
      )}
      {pattern && week && (
        <PatternModal
          week={week} people={week.people.filter((p) => selected.has(p.user_id))}
          onClose={() => setPattern(false)}
          onDone={(o) => { setPattern(false); setSelected(new Set()); afterApply(o); }}
        />
      )}
      {needs && (
        <NeedsModal shift={needs} onClose={() => setNeeds(null)} onSaved={() => { setNeeds(null); setNotice('Saved.'); load(); }} />
      )}
      {publishing && week && (
        <PublishModal week={week} onClose={() => setPublishing(false)} onDone={() => { setPublishing(false); setNotice('Roster published.'); load(); }} />
      )}
    </div>
  );
}

const footerBtn = 'rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60';

function CellModal({ edit, week, shiftStyle, onClose, onDone, onError }: {
  edit: Edit; week: PlannerWeek; shiftStyle: (id: string) => (typeof SHIFT_STYLE)[number];
  onClose: () => void; onDone: (o: ApplyShiftsOutcome) => void; onError: (m: string) => void;
}) {
  const current = edit.person.days.find((d) => d.date === edit.date)?.shift_id ?? null;
  const [shiftId, setShiftId] = useState<string | null>(current);
  const [to, setTo] = useState(edit.date);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (to < edit.date) { setErr('The end date is before the start date.'); return; }
    setBusy(true);
    try {
      const r = await planner.apply({ user_ids: [edit.person.user_id], from: edit.date, to, shift_id: shiftId });
      onDone(r.data);
    } catch (e) { const m = e instanceof Error ? e.message : 'Could not save.'; setErr(m); onError(m); } finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className={`${footerBtn} border border-outline-variant bg-surface-container-lowest text-on-surface-variant`}>Cancel</button>
      <button type="button" onClick={() => void save()} disabled={busy} className={`${footerBtn} bg-primary text-on-primary`}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`${edit.person.full_name} · ${monthShort(edit.date)}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {err && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{err}</div>}
        <fieldset className="flex flex-col gap-1.5">
          <legend className={fieldLabelCls}>Shift</legend>
          {week.shifts.map((s) => (
            <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${shiftId === s.id ? 'border-primary bg-primary-fixed/40' : 'border-outline-variant'}`}>
              <input type="radio" name="shift" checked={shiftId === s.id} onChange={() => setShiftId(s.id)} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: shiftStyle(s.id).dot }} aria-hidden="true" />
              <span className="font-semibold text-on-surface">{s.name}</span>
              <span className="ml-auto tabular-nums text-on-surface-variant">{s.start}–{s.end}{s.is_night ? ' (+1 day)' : ''}</span>
            </label>
          ))}
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${shiftId === null ? 'border-primary bg-primary-fixed/40' : 'border-outline-variant'}`}>
            <input type="radio" name="shift" checked={shiftId === null} onChange={() => setShiftId(null)} />
            <span className="text-on-surface">No shift (clear)</span>
          </label>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cm-to" className={fieldLabelCls}>Apply through (leave as is for this day only)</label>
          <input id="cm-to" type="date" min={edit.date} value={to} onChange={(e) => setTo(e.target.value)} className={`${fieldInputCls} w-48`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}

function PatternModal({ week, people, onClose, onDone }: {
  week: PlannerWeek; people: PlannerPerson[]; onClose: () => void; onDone: (o: ApplyShiftsOutcome) => void;
}) {
  const today = todayIso();
  const [shiftId, setShiftId] = useState<string>(week.shifts[0]?.id ?? '');
  const [from, setFrom] = useState(week.week_start < today ? today : week.week_start);
  const [to, setTo] = useState(week.week_end < today ? today : week.week_end);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (clear: boolean) => {
    setErr(null);
    if (!clear && !shiftId) { setErr('Choose a shift.'); return; }
    if (from < today) { setErr('Plan from today onwards.'); return; }
    if (to < from) { setErr('The end date is before the start date.'); return; }
    setBusy(true);
    try {
      const r = await planner.apply({ user_ids: people.map((p) => p.user_id), from, to, shift_id: clear ? null : shiftId });
      onDone(r.data);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className={`${footerBtn} border border-outline-variant bg-surface-container-lowest text-on-surface-variant`}>Cancel</button>
      <button type="button" onClick={() => void save(true)} disabled={busy} className={`${footerBtn} border border-status-overdue/40 bg-status-overdue-container text-on-status-overdue-container`}>Clear these dates</button>
      <button type="button" onClick={() => void save(false)} disabled={busy} className={`${footerBtn} bg-primary text-on-primary`}>{busy ? 'Saving…' : 'Assign'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Assign a shift to ${people.length} ${people.length === 1 ? 'person' : 'people'}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {err && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{err}</div>}
        <p className="max-h-20 overflow-y-auto text-xs text-on-surface-variant">{people.map((p) => p.full_name).join(', ')}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pm-shift" className={fieldLabelCls}>Shift</label>
          <select id="pm-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} className={fieldInputCls} disabled={busy}>
            {week.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><label htmlFor="pm-from" className={fieldLabelCls}>From</label><input id="pm-from" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} className={fieldInputCls} disabled={busy} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="pm-to" className={fieldLabelCls}>To</label><input id="pm-to" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} className={fieldInputCls} disabled={busy} /></div>
        </div>
        <p className="text-xs text-on-surface-variant">Weekly offs, holidays and approved leave stay as they are. People whose rest between shifts would fall under 11 hours are skipped and listed.</p>
      </div>
    </Modal>
  );
}

function NeedsModal({ shift, onClose, onSaved }: { shift: PlannerShift; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(String(shift.required ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) { setErr('Enter a whole number, zero or more.'); return; }
    setBusy(true);
    try { await planner.setRequirement(shift.id, n); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className={`${footerBtn} border border-outline-variant bg-surface-container-lowest text-on-surface-variant`}>Cancel</button>
      <button type="button" onClick={() => void save()} disabled={busy} className={`${footerBtn} bg-primary text-on-primary`}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`${shift.name}: people needed`} locked={busy} maxWidth="max-w-sm" footer={footer}>
      <div className="flex flex-col gap-2">
        {err && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{err}</div>}
        <label htmlFor="nd-n" className={fieldLabelCls}>How many people does this shift need each day?</label>
        <input id="nd-n" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={`${fieldInputCls} w-32`} disabled={busy} />
        <p className="text-xs text-on-surface-variant">Used for the Short / Full / Over marker on the capacity cards.</p>
      </div>
    </Modal>
  );
}

function PublishModal({ week, onClose, onDone }: { week: PlannerWeek; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const unassigned = week.people.filter((p) => p.days.some((d) => d.kind === 'none')).length;
  const save = async () => {
    setBusy(true);
    try { await planner.publish(week.week_start, note.trim() || undefined); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not publish.'); } finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className={`${footerBtn} border border-outline-variant bg-surface-container-lowest text-on-surface-variant`}>Not yet</button>
      <button type="button" onClick={() => void save()} disabled={busy} className={`${footerBtn} bg-primary text-on-primary`}>{busy ? 'Publishing…' : 'Publish'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Publish ${monthShort(week.week_start)} – ${monthShort(week.week_end)}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {err && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{err}</div>}
        <p className="text-sm text-on-surface-variant">
          This records the week as published, with your name and the time. Shifts you set are already live; publishing is how HR marks a roster as final.
          {unassigned > 0 && <> <strong className="text-on-surface">{unassigned}</strong> {unassigned === 1 ? 'person still has' : 'people still have'} a working day with no shift.</>}
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pb-note" className={fieldLabelCls}>Note (optional)</label>
          <textarea id="pb-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}
