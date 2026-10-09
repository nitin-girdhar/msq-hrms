'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, Button, InfoTip, Modal, PageBody, PageHeader, useIsMobile } from '@platform/ui-kit';
import { planner, swaps } from '../../lib/api/client';
import type { ShiftSwap } from '../../lib/team/types';
import {
  SHIFT_STYLE,
  addDaysIso,
  type ApplyShiftsOutcome,
  type PlannerPerson,
  type PlannerShift,
  type PlannerView,
  type PlannerWeek,
  stepStart,
} from '../../lib/planner/types';
import { formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';
import PersonAvatar from '../common/PersonAvatar';
import StatCard from '../common/StatCard';

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
export default function PlannerShell({ actor }: { actor: SessionUser }) {
  const mobile = useIsMobile(767);
  const [view, setView] = useState<PlannerView>('week');
  // Day picked in the phone day strip; null follows today (or the first day).
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [reallocating, setReallocating] = useState(false);
  const [query, setQuery] = useState('');
  const [week, setWeek] = useState<PlannerWeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<ApplyShiftsOutcome['skipped']>([]);
  // Edits held back by the minimum-rest policy. `confirm` re-sends exactly those people with the warning accepted.
  const [rest, setRest] = useState<{ warnings: ApplyShiftsOutcome['warnings']; confirm: () => Promise<{ data: ApplyShiftsOutcome }> } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Edit | null>(null);
  const [pattern, setPattern] = useState(false);
  const [needs, setNeeds] = useState<PlannerShift | null>(null);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(() => {
    planner
      .week({ view, ...(from ? { from } : {}), ...(query.trim() ? { q: query.trim() } : {}) })
      .then((r) => { setWeek(r.data); setError(null); })
      .catch((e) => { setWeek(null); setError(e instanceof Error ? e.message : 'Failed to load the planner.'); });
  }, [view, from, query]);

  useEffect(() => { setPickedDay(null); }, [view, from]);

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
  const dates = week ? Array.from({ length: Math.round((Date.parse(`${week.week_end}T00:00:00Z`) - Date.parse(`${week.week_start}T00:00:00Z`)) / 86_400_000) + 1 }, (_, i) => addDaysIso(week.week_start, i)) : [];
  // The day the capacity cards describe: today when it is in view, otherwise the first day.
  const defaultIdx = week && today >= week.week_start && today <= week.week_end ? dates.indexOf(today) : 0;
  const focusIdx = pickedDay !== null && pickedDay < dates.length ? pickedDay : defaultIdx;
  const compact = view === 'month';
  const dow = (iso: string) => DOW[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7]!;
  const rangeLabel = !week ? '…' : view === 'day' ? new Date(`${week.week_start}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : view === 'month' ? new Date(`${week.week_start}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : `${monthShort(week.week_start)} – ${monthShort(week.week_end)} ${week.week_end.slice(0, 4)}`;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShown = week ? week.people.length > 0 && week.people.every((p) => selected.has(p.user_id)) : false;

  const afterApply = (o: ApplyShiftsOutcome, confirm?: () => Promise<{ data: ApplyShiftsOutcome }>) => {
    setSkipped(o.skipped);
    setRest(o.warnings.length > 0 && confirm ? { warnings: o.warnings, confirm } : null);
    setNotice(o.applied > 0 ? `Updated ${o.applied} ${o.applied === 1 ? 'person' : 'people'}.` : null);
    if (o.applied === 0 && o.skipped.length === 0 && o.warnings.length === 0) setNotice('Nothing needed to change.');
    load();
  };

  const confirmRest = async () => {
    if (!rest) return;
    setConfirming(true);
    try { afterApply((await rest.confirm()).data); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not apply the change.'); }
    finally { setConfirming(false); }
  };

  const exportCsv = () => {
    if (!week) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ['Name', 'Code', ...dates.map((d) => `${dow(d)} ${d}`)];
    const rows = week.people.map((p) => [
      p.full_name, p.employee_code ?? '',
      ...p.days.map((d) => (d.kind === 'shift' ? (shiftById.get(d.shift_id!)?.name ?? '') : d.kind === 'off' || d.kind === 'holiday' || d.kind === 'leave' ? NON_SHIFT[d.kind][0] : '')),
    ]);
    const csv = [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `roster-${view}-${week.week_start}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Roster planner"
        info="Plan who works which shift. Click a day to change it; tick people to set a shift for a date range."
        actions={
          <>
            <Button variant="secondary" className="max-lg:min-h-11" onClick={exportCsv} disabled={!week || week.people.length === 0}>Export</Button>
            <Button variant="secondary" className="max-lg:min-h-11" onClick={() => setReallocating(true)} disabled={!week || week.shifts.length < 2}>Bulk reallocate</Button>
            <Button variant="secondary" className="max-lg:min-h-11" onClick={() => setPattern(true)} disabled={selected.size === 0}>Assign shift pattern{selected.size ? ` (${selected.size})` : ''}</Button>
            {view === 'week' && <Button variant="primary" className="max-lg:min-h-11" onClick={() => setPublishing(true)} disabled={!week}>Publish roster</Button>}
          </>
        }
      />
      <PageBody dense>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {rest && (
          <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-4 py-3 text-sm text-on-status-due-container">
            <p className="font-semibold">{rest.warnings.length} {rest.warnings.length === 1 ? 'person has' : 'people have'} less rest between shifts than the policy asks for. Nothing was changed for {rest.warnings.length === 1 ? 'them' : 'them'} yet:</p>
            <ul className="mt-1 list-disc pl-5">{rest.warnings.map((s) => <li key={s.user_id}>{s.full_name} - {s.reason}</li>)}</ul>
            <div className="mt-2 flex gap-2">
              <Button variant="primary" className="max-lg:min-h-11" onClick={() => void confirmRest()} disabled={confirming}>{confirming ? 'Applying…' : 'Assign anyway'}</Button>
              <Button variant="secondary" className="max-lg:min-h-11" onClick={() => setRest(null)} disabled={confirming}>Leave as is</Button>
            </div>
          </div>
        )}
        {skipped.length > 0 && (
          <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-4 py-3 text-sm text-on-status-due-container">
            <p className="font-semibold">{skipped.length} {skipped.length === 1 ? 'person was' : 'people were'} not changed:</p>
            <ul className="mt-1 list-disc pl-5">{skipped.map((s) => <li key={s.user_id}>{s.full_name} - {s.reason}</li>)}</ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
          <div className="flex gap-1 rounded-lg border border-outline-variant bg-surface-container-low p-1" role="tablist" aria-label="Roster view">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => { setView(v); setFrom(week && today >= week.week_start && today <= week.week_end ? today : week?.week_start); }}
                className={`rounded-md px-3 py-1 text-xs font-semibold capitalize max-lg:min-h-11 ${view === v ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>{v}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-low px-1 py-1">
            <button type="button" aria-label={`Previous ${view}`} onClick={() => week && setFrom(stepStart(view, week.week_start, -1))} className="rounded px-2 py-1 text-on-surface-variant hover:bg-surface-container max-lg:h-11 max-lg:w-11">‹</button>
            <span className="min-w-36 text-center text-sm font-semibold text-on-surface sm:min-w-44">{rangeLabel}</span>
            <button type="button" aria-label={`Next ${view}`} onClick={() => week && setFrom(stepStart(view, week.week_start, 1))} className="rounded px-2 py-1 text-on-surface-variant hover:bg-surface-container max-lg:h-11 max-lg:w-11">›</button>
          </div>
          <Button variant="secondary" className="max-lg:min-h-11" onClick={() => setFrom(undefined)}>Today</Button>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or code" aria-label="Search people" className={`${fieldInputCls} h-11 w-full sm:h-10 sm:w-64`} />
          {week && view === 'week' && (
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
              <StatCard
                label="Headcount pool" value={week.headcount}
                hint={`${Object.values(week.assigned).reduce((n, d) => n + (d[focusIdx] ?? 0), 0)} on a shift ${dates[focusIdx] === today ? 'today' : `on ${monthShort(dates[focusIdx] ?? week.week_start)}`}`}
              />
              {week.shifts.map((s) => {
                const have = week.assigned[s.id]?.[focusIdx] ?? 0;
                const pct = s.required ? Math.min(100, Math.round((have / s.required) * 100)) : 0;
                const state = s.required === null ? null : have < s.required ? 'Short' : have === s.required ? 'Full' : 'Over';
                return (
                  <button key={s.id} type="button" onClick={() => setNeeds(s)} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-left shadow-sm transition-colors hover:border-primary">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-1.5 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: shiftStyle(s.id).dot }} aria-hidden="true" /><span className="truncate">{s.name}</span>
                      </p>
                      <span className="shrink-0 font-mono text-label-sm tabular-nums text-on-surface-variant">{s.start}–{s.end}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="font-mono text-headline-lg font-bold tabular-nums text-on-surface">
                        {have}<span className="text-base font-medium text-on-surface-variant"> / {s.required ?? '—'}</span>
                      </p>
                      {state && <span className={`rounded-full px-2 py-0.5 text-label-sm font-semibold ${state === 'Short' ? 'bg-status-overdue-container text-on-status-overdue-container' : state === 'Full' ? 'bg-status-success-container text-on-status-success-container' : 'bg-status-due-container text-on-status-due-container'}`}>{state}</span>}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container" aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: shiftStyle(s.id).dot }} /></div>
                    <p className="mt-1.5 text-label-sm font-medium text-primary">{s.required === null ? 'Click to set number needed' : 'Click to change number needed'}</p>
                  </button>
                );
              })}
            </div>

            {week.shifts.length === 0 && <p className={emptyBlockCls}>No shifts are defined for this branch yet. Add them under Attendance admin → Shifts, then plan them here.</p>}

            {view === 'day' && <DayLanes week={week} shiftStyle={shiftStyle} onPick={(p) => setEdit({ person: p, date: week.week_start })} />}
            {view === 'week' && mobile && (
              <MobileRoster
                week={week} dates={dates} dayIdx={focusIdx} today={today} dow={dow} shiftStyle={shiftStyle} shiftById={shiftById}
                selected={selected} onToggle={toggle} allShown={allShown}
                onToggleAll={() => setSelected(allShown ? new Set() : new Set(week.people.map((p) => p.user_id)))}
                onPickDay={setPickedDay} onEdit={(p, d) => setEdit({ person: p, date: d })}
              />
            )}
            {view !== 'day' && !(mobile && view === 'week') && <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
              <table className={`w-full border-collapse text-sm ${compact ? 'min-w-[72rem]' : 'min-w-[56rem]'}`}>
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-sm uppercase tracking-wide text-on-surface-variant">
                    <th className={`${compact ? 'w-56' : 'w-72'} px-3 py-2`}>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={allShown} onChange={() => setSelected(allShown ? new Set() : new Set(week.people.map((p) => p.user_id)))} aria-label="Select everyone shown" />
                        Staff
                      </label>
                    </th>
                    {dates.map((d) => (
                      <th key={d} className={`${compact ? 'px-0.5' : 'px-2'} py-2 text-center ${d === today ? 'bg-primary-fixed text-on-primary-fixed' : ''}`}>
                        {compact ? dow(d).slice(0, 1) : dow(d)} <span className="block font-mono text-sm normal-case text-on-surface">{dayNum(d)}</span>
                        {d === today && !compact && <span className="text-[0.625rem] normal-case">Today</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {week.people.length === 0 && (
                    <tr><td colSpan={dates.length + 1} className="px-4 py-8 text-center text-on-surface-variant">No one matches.</td></tr>
                  )}
                  {week.people.map((p) => (
                    <tr key={p.user_id} className="border-b border-outline-variant/50 last:border-0">
                      <td className="px-3 py-1.5">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={selected.has(p.user_id)} onChange={() => toggle(p.user_id)} aria-label={`Select ${p.full_name}`} />
                          {!compact && <PersonAvatar name={p.full_name} userId={p.user_id} size="sm" />}
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
                          <td key={d.date} className={`${compact ? 'px-0.5' : 'px-1'} py-1 text-center ${d.date === today ? 'bg-primary-fixed/30' : ''}`}>
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() => setEdit({ person: p, date: d.date })}
                              title={editable ? 'Change this day' : 'Past days are already resolved into attendance'}
                              className="w-full rounded-lg px-1 py-1 text-label-sm transition-opacity enabled:hover:ring-2 enabled:hover:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {compact ? (
                                <span title={s ? `${s.name} ${s.start}–${s.end}` : d.kind} className={`block rounded px-0.5 py-1 text-[0.625rem] font-semibold ${s && d.kind === 'shift' ? shiftStyle(s.id).chip : d.kind === 'none' ? 'border border-dashed border-outline-variant text-outline' : d.kind === 'off' || d.kind === 'holiday' || d.kind === 'leave' ? NON_SHIFT[d.kind][1] : ''}`}>
                                  {s && d.kind === 'shift' ? s.name.slice(0, 2) : d.kind === 'none' ? '+' : d.kind === 'off' || d.kind === 'holiday' || d.kind === 'leave' ? NON_SHIFT[d.kind][0].slice(0, 1) : ''}
                                </span>
                              ) : d.kind === 'shift' && s ? (
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
              <p className="border-t border-outline-variant px-3 py-2 text-label-sm text-on-surface-variant">
                Showing {week.people.length} staff {week.people.length === 1 ? 'member' : 'members'}
              </p>
            </div>}
            <div className="grid gap-4 lg:grid-cols-2">
              <CapacityDonut week={week} dayIdx={focusIdx} date={dates[focusIdx] ?? week.week_start} shiftStyle={shiftStyle} />
              {can(actor, CAPABILITY.HR_ATTENDANCE_SWAP_APPROVE) && <SwapDesk onChanged={load} />}
            </div>
            <p className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
              Planner rules
              <InfoTip label="About planner rules">A shift set on a weekly off or holiday is kept but shows as off. Every change is checked against the 11-hour rest rule and recorded in the audit log.</InfoTip>
            </p>
          </>
        )}
      </PageBody>

      {edit && week && (
        <CellModal
          edit={edit} week={week} shiftStyle={shiftStyle}
          onClose={() => setEdit(null)}
          onDone={(o, c) => { setEdit(null); afterApply(o, c); }}
          onError={setError}
        />
      )}
      {pattern && week && (
        <PatternModal
          week={week} people={week.people.filter((p) => selected.has(p.user_id))}
          onClose={() => setPattern(false)}
          onDone={(o, c) => { setPattern(false); setSelected(new Set()); afterApply(o, c); }}
        />
      )}
      {needs && (
        <NeedsModal shift={needs} onClose={() => setNeeds(null)} onSaved={() => { setNeeds(null); setNotice('Saved.'); load(); }} />
      )}
      {reallocating && week && (
        <ReallocateModal week={week} selected={[...selected]} onClose={() => setReallocating(false)} onDone={(o, c) => { setReallocating(false); afterApply(o, c); }} />
      )}
      {publishing && week && (
        <PublishModal week={week} onClose={() => setPublishing(false)} onDone={() => { setPublishing(false); setNotice('Roster published.'); load(); }} />
      )}
    </div>
  );
}

const footerBtn = 'rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60 max-lg:min-h-11';

function CellModal({ edit, week, shiftStyle, onClose, onDone, onError }: {
  edit: Edit; week: PlannerWeek; shiftStyle: (id: string) => (typeof SHIFT_STYLE)[number];
  onClose: () => void; onDone: (o: ApplyShiftsOutcome, confirm?: () => Promise<{ data: ApplyShiftsOutcome }>) => void; onError: (m: string) => void;
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
      const body = { user_ids: [edit.person.user_id], from: edit.date, to, shift_id: shiftId };
      const r = await planner.apply(body);
      onDone(r.data, () => planner.apply({ ...body, confirm_rest_warnings: true }));
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
  week: PlannerWeek; people: PlannerPerson[]; onClose: () => void; onDone: (o: ApplyShiftsOutcome, confirm?: () => Promise<{ data: ApplyShiftsOutcome }>) => void;
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
      const body = { user_ids: people.map((p) => p.user_id), from, to, shift_id: clear ? null : shiftId };
      const r = await planner.apply(body);
      // Re-send only the people held back, so everyone already updated is left alone.
      onDone(r.data, () => planner.apply({ ...body, user_ids: r.data.warnings.map((w) => w.user_id), confirm_rest_warnings: true }));
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
        <p className="text-xs text-on-surface-variant">Weekly offs, holidays and approved leave stay as they are. If someone's rest between shifts would fall under the minimum set in the attendance policy, you are warned and can choose to assign anyway.</p>
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

/** Phone week view: a day strip, then everyone's assignment for the picked day as a tappable list. */
function MobileRoster({ week, dates, dayIdx, today, dow, shiftStyle, shiftById, selected, onToggle, allShown, onToggleAll, onPickDay, onEdit }: {
  week: PlannerWeek; dates: string[]; dayIdx: number; today: string; dow: (iso: string) => string;
  shiftStyle: (id: string) => (typeof SHIFT_STYLE)[number]; shiftById: Map<string, PlannerShift>;
  selected: Set<string>; onToggle: (id: string) => void; allShown: boolean; onToggleAll: () => void;
  onPickDay: (i: number) => void; onEdit: (p: PlannerPerson, date: string) => void;
}) {
  const date = dates[dayIdx] ?? week.week_start;
  const editable = date >= today;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Day of the week">
        {dates.map((d, i) => {
          const working = week.people.some((p) => p.days[i]?.kind === 'shift');
          return (
            <button
              key={d} type="button" onClick={() => onPickDay(i)} aria-pressed={i === dayIdx}
              className={`flex min-h-16 min-w-12 shrink-0 flex-col items-center justify-center rounded-xl border px-2 py-1 ${i === dayIdx ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-lowest text-on-surface'}`}
            >
              <span className="text-label-sm uppercase">{dow(d)}</span>
              <span className="font-mono text-base font-bold">{dayNum(d)}</span>
              <span className="text-label-sm">{d === today ? 'Today' : working ? '•' : ''}</span>
            </button>
          );
        })}
      </div>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-3 py-1">
          <h3 className="text-sm font-semibold text-on-surface">Scheduled staff <span className="ml-1 rounded-full bg-surface-container px-2 py-0.5 text-label-sm font-medium text-on-surface-variant">{week.people.length}</span></h3>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-primary">
            <input type="checkbox" checked={allShown} onChange={onToggleAll} aria-label="Select everyone shown" />
            Select all
          </label>
        </div>
        {week.people.length === 0 ? <p className="px-4 py-8 text-center text-sm text-on-surface-variant">No one matches.</p> : (
          <ul>
            {week.people.map((p) => {
              const d = p.days[dayIdx];
              const s = d?.shift_id ? shiftById.get(d.shift_id) : null;
              const away = d && (d.kind === 'off' || d.kind === 'holiday' || d.kind === 'leave') ? NON_SHIFT[d.kind] : null;
              return (
                <li key={p.user_id} className="flex items-center gap-1 border-b border-outline-variant/50 px-1 last:border-0">
                  <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                    <input type="checkbox" checked={selected.has(p.user_id)} onChange={() => onToggle(p.user_id)} aria-label={`Select ${p.full_name}`} />
                  </label>
                  <button
                    type="button" disabled={!editable} onClick={() => onEdit(p, date)} title={editable ? 'Change this day' : 'Past days are already resolved into attendance'}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <PersonAvatar name={p.full_name} userId={p.user_id} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-on-surface">{p.full_name}</span>
                      <span className="block truncate text-label-sm text-on-surface-variant">{[p.employee_code, p.designation_name].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    {d?.kind === 'shift' && s ? (
                      <span className={`shrink-0 rounded-lg px-2 py-1 text-label-sm ${shiftStyle(s.id).chip}`}>
                        <span className="block max-w-28 truncate font-semibold">{s.name}</span>
                        <span className="block font-mono tabular-nums opacity-80">{s.start}–{s.end}</span>
                      </span>
                    ) : away ? (
                      <span className={`shrink-0 rounded-lg px-2 py-1 text-label-sm font-medium ${away[1]}`}>{away[0]}</span>
                    ) : (
                      <span className="shrink-0 rounded-lg border border-dashed border-outline-variant px-2 py-1 text-label-sm text-outline">+ Assign</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Day view: one lane per shift listing who is on it, then everyone with no shift, off or on leave. */
function DayLanes({ week, shiftStyle, onPick }: {
  week: PlannerWeek; shiftStyle: (id: string) => (typeof SHIFT_STYLE)[number]; onPick: (p: PlannerPerson) => void;
}) {
  const dayOf = (p: PlannerPerson) => p.days[0]!;
  const lanes = week.shifts.map((s) => ({ shift: s, people: week.people.filter((p) => dayOf(p).shift_id === s.id) }));
  const unassigned = week.people.filter((p) => dayOf(p).kind === 'none');
  const away = week.people.filter((p) => ['off', 'holiday', 'leave'].includes(dayOf(p).kind));
  const lane = (title: string, sub: string, dot: string | null, people: PlannerPerson[], key: string) => (
    <section key={key} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface">
        {dot && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />}{title}
        <span className="ml-auto font-mono text-xs font-bold text-on-surface-variant">{people.length}</span>
      </h3>
      <p className="mb-2 text-label-sm text-on-surface-variant">{sub}</p>
      {people.length === 0 ? <p className="text-sm text-outline">No one.</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {people.map((p) => (
            <li key={p.user_id}>
              <button type="button" onClick={() => onPick(p)} title="Change this day" className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-xs font-medium text-on-surface hover:border-primary">
                {p.full_name}{dayOf(p).kind === 'off' ? ' · off' : dayOf(p).kind === 'holiday' ? ' · holiday' : dayOf(p).kind === 'leave' ? ' · leave' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {lanes.map(({ shift, people }) => lane(shift.name, `${shift.start}–${shift.end}${shift.is_night ? ' (+1 day)' : ''}${shift.required !== null ? ` · needs ${shift.required}` : ''}`, shiftStyle(shift.id).dot, people, shift.id))}
      {lane('No shift yet', 'Working day with nothing assigned', null, unassigned, 'none')}
      {lane('Off, holiday or leave', 'Not planned', null, away, 'away')}
    </div>
  );
}

/** Who is on which shift on the focus day, as a donut, with the people still unassigned in the middle of the story. */
function CapacityDonut({ week, dayIdx, date, shiftStyle }: {
  week: PlannerWeek; dayIdx: number; date: string; shiftStyle: (id: string) => (typeof SHIFT_STYLE)[number];
}) {
  const parts = week.shifts.map((s) => ({ s, n: week.assigned[s.id]?.[dayIdx] ?? 0 })).filter((x) => x.n > 0);
  const onShift = parts.reduce((n, x) => n + x.n, 0);
  const unassigned = week.people.filter((p) => p.days[dayIdx]?.kind === 'none').length;
  const total = onShift + unassigned;
  const r = 38;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <h3 className="text-base font-semibold text-on-surface">Capacity distribution</h3>
      <p className="mb-3 text-xs text-on-surface-variant">{monthShort(date)}: working people by shift</p>
      {total === 0 ? <p className="text-sm text-on-surface-variant">No one is planned to work that day.</p> : (
        <div className="flex items-center gap-4">
          <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={`${onShift} of ${total} working people have a shift`} className="shrink-0">
            <circle cx="52" cy="52" r={r} fill="none" strokeWidth="14" className="stroke-surface-container-high" />
            {parts.map(({ s, n }) => {
              const len = (n / total) * c;
              const el = <circle key={s.id} cx="52" cy="52" r={r} fill="none" strokeWidth="14" stroke={shiftStyle(s.id).dot} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 52 52)" />;
              offset += len;
              return el;
            })}
            <text x="52" y="50" textAnchor="middle" className="fill-on-surface text-[1.25rem] font-bold">{total}</text>
            <text x="52" y="65" textAnchor="middle" className="fill-on-surface-variant text-[0.5625rem]">working</text>
          </svg>
          <ul className="min-w-0 flex-1 space-y-1 text-sm">
            {parts.map(({ s, n }) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-on-surface-variant"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: shiftStyle(s.id).dot }} aria-hidden="true" /><span className="truncate">{s.name}</span></span>
                <span className="font-mono font-semibold tabular-nums text-on-surface">{n} <span className="font-normal text-on-surface-variant">({Math.round((n / total) * 100)}%)</span></span>
              </li>
            ))}
            {unassigned > 0 && <li className="flex items-center justify-between gap-2 text-status-due"><span>No shift yet</span><span className="font-mono font-semibold tabular-nums">{unassigned}</span></li>}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Pending shift swaps waiting for an approver (the same approval the team page offers), without leaving the planner. */
function SwapDesk({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<ShiftSwap[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const load = useCallback(() => {
    swaps.queue().then((r) => setItems(r.data.filter((s) => s.status === 'pending_manager'))).catch((e) => { setItems([]); setError(e instanceof Error ? e.message : 'Failed to load swaps.'); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setError(null);
    if (!approve && !comment.trim()) { setError('Say why it is being declined.'); return; }
    setBusy(id);
    try {
      if (approve) await swaps.approve(id); else await swaps.reject(id, comment.trim());
      setDeclining(null); setComment(''); load(); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the decision.'); } finally { setBusy(null); }
  };

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-base font-semibold text-on-surface">
        Swap requests
        {items && items.length > 0 && <span className="rounded-full bg-status-overdue px-2 py-0.5 text-label-sm font-bold text-on-status-overdue">{items.length}</span>}
      </h3>
      <p className="mb-2 flex items-center gap-1.5 text-xs text-on-surface-variant">
        Swap desk
        <InfoTip label="About swap requests">Two people agreed to trade a day; approving changes both rosters.</InfoTip>
      </p>
      {error && <div role="alert" className="mb-2 rounded-lg border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
      {items === null ? <p className="text-sm text-on-surface-variant">Loading…</p> : items.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Nothing waiting for you.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="rounded-lg border border-outline-variant/60 bg-surface-container-low p-3">
              <p className="text-sm font-semibold text-on-surface">{s.requester_name} <span className="font-normal text-on-surface-variant">({s.requester_shift})</span> ⇄ {s.peer_name} <span className="font-normal text-on-surface-variant">({s.peer_shift})</span></p>
              <p className="text-xs text-on-surface-variant">{monthShort(s.swap_date)} · “{s.reason}”</p>
              {declining === s.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={300} placeholder="Reason for declining" aria-label="Reason for declining" className={`${fieldInputCls} h-auto py-2`} />
                  <div className="flex gap-2">
                    <Button variant="danger" className="max-lg:min-h-11" disabled={busy === s.id} onClick={() => void decide(s.id, false)}>Decline</Button>
                    <Button variant="secondary" className="max-lg:min-h-11" onClick={() => { setDeclining(null); setComment(''); }}>Back</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <Button variant="primary" className="max-lg:min-h-11" disabled={busy === s.id} onClick={() => void decide(s.id, true)}>Approve swap</Button>
                  <Button variant="secondary" className="max-lg:min-h-11" disabled={busy === s.id} onClick={() => setDeclining(s.id)}>Decline</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReallocateModal({ week, selected, onClose, onDone }: {
  week: PlannerWeek; selected: string[]; onClose: () => void; onDone: (o: ApplyShiftsOutcome, confirm?: () => Promise<{ data: ApplyShiftsOutcome }>) => void;
}) {
  const today = todayIso();
  const [fromShift, setFromShift] = useState(week.shifts[0]?.id ?? '');
  const [toShift, setToShift] = useState(week.shifts[1]?.id ?? '');
  const [from, setFrom] = useState(week.week_start < today ? today : week.week_start);
  const [to, setTo] = useState(week.week_end < today ? today : week.week_end);
  const [onlySelected, setOnlySelected] = useState(selected.length > 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (fromShift === toShift) { setErr('Choose two different shifts.'); return; }
    if (from < today) { setErr('Plan from today onwards.'); return; }
    if (to < from) { setErr('The end date is before the start date.'); return; }
    setBusy(true);
    try {
      const body = { from_shift_id: fromShift, to_shift_id: toShift, from, to, ...(onlySelected && selected.length ? { user_ids: selected } : {}) };
      const r = await planner.reallocate(body);
      onDone(r.data, () => planner.reallocate({ ...body, user_ids: r.data.warnings.map((w) => w.user_id), confirm_rest_warnings: true }));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reallocate.'); } finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className={`${footerBtn} border border-outline-variant bg-surface-container-lowest text-on-surface-variant`}>Cancel</button>
      <button type="button" onClick={() => void save()} disabled={busy} className={`${footerBtn} bg-primary text-on-primary`}>{busy ? 'Moving…' : 'Reallocate'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="Bulk reallocate" locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {err && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{err}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ra-from" className={fieldLabelCls}>Move people off</label>
            <select id="ra-from" value={fromShift} onChange={(e) => setFromShift(e.target.value)} className={fieldInputCls} disabled={busy}>{week.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ra-to" className={fieldLabelCls}>…onto</label>
            <select id="ra-to" value={toShift} onChange={(e) => setToShift(e.target.value)} className={fieldInputCls} disabled={busy}>{week.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          <div className="flex flex-col gap-1.5"><label htmlFor="ra-d1" className={fieldLabelCls}>From</label><input id="ra-d1" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} className={fieldInputCls} disabled={busy} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="ra-d2" className={fieldLabelCls}>To</label><input id="ra-d2" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} className={fieldInputCls} disabled={busy} /></div>
        </div>
        {selected.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-on-surface"><input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} disabled={busy} /> Only the {selected.length} ticked {selected.length === 1 ? 'person' : 'people'}</label>
        )}
        <p className="text-xs text-on-surface-variant">Only days someone is on the first shift change. If someone's rest between shifts would fall under the attendance policy minimum, you are warned and can choose to assign anyway.</p>
      </div>
    </Modal>
  );
}
