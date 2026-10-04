'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, Button, Modal, PageBody, PageHeader, PageSection, SpeechInputButton, appendDictation, exportRows } from '@platform/ui-kit';
import { profile as profileApi, swaps } from '../../lib/api/client';
import type { ChainLink } from '../../lib/profile/types';
import PersonAvatar from '../common/PersonAvatar';
import type { Roster, RosterDay, RosterPerson, ShiftSwap } from '../../lib/team/types';
import { SWAP_STATUS_LABEL } from '../../lib/team/types';
import { formatDay } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

interface Props {
  actor: SessionUser;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (iso: string) => DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const dom = (iso: string) => String(Number(iso.slice(8, 10)));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayLocal = () => new Date().toLocaleDateString('en-CA');
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// One colour per shift, from the fixed categorical hues (a shift is the same colour for every
// tenant and in dark mode); the index follows the alphabetical shift list so it is stable.
const SHIFT_STYLE = [
  { chip: 'bg-cat-blue-container text-on-cat-blue-container', dot: 'var(--color-cat-blue)' },
  { chip: 'bg-cat-green-container text-on-cat-green-container', dot: 'var(--color-cat-green)' },
  { chip: 'bg-cat-orange-container text-on-cat-orange-container', dot: 'var(--color-cat-orange)' },
  { chip: 'bg-cat-purple-container text-on-cat-purple-container', dot: 'var(--color-cat-purple)' },
  { chip: 'bg-cat-cyan-container text-on-cat-cyan-container', dot: 'var(--color-cat-cyan)' },
  { chip: 'bg-cat-pink-container text-on-cat-pink-container', dot: 'var(--color-cat-pink)' },
] as const;

const NON_SHIFT = {
  off: ['Weekly off', 'bg-surface-container text-on-surface-variant'],
  holiday: ['Holiday', 'bg-cat-purple-container text-on-cat-purple-container'],
  leave: ['On leave', 'bg-status-info-container text-on-status-info-container'],
} as const;

function cellText(d: RosterDay): string {
  if (d.kind === 'shift') return `${d.shift_name} ${d.start}–${d.end}`;
  if (d.kind === 'none') return 'No shift';
  return NON_SHIFT[d.kind][0];
}

function Cell({ day, styleFor, dim }: { day: RosterDay; styleFor: (name: string) => (typeof SHIFT_STYLE)[number]; dim: boolean }) {
  if (day.kind === 'shift') {
    return (
      <div className={`rounded-lg px-2 py-1 text-label-sm ${styleFor(day.shift_name!).chip} ${dim ? 'opacity-30' : ''}`}>
        <p className="truncate font-semibold">{day.shift_name}</p>
        <p className="tabular-nums opacity-80">{day.start}–{day.end}</p>
      </div>
    );
  }
  // "No shift" is quiet on purpose: a roster with nothing assigned should not shout in every cell.
  if (day.kind === 'none') return <div className="px-2 py-1 text-label-sm text-outline">—</div>;
  const [label, cls] = NON_SHIFT[day.kind];
  return <div className={`rounded-lg px-2 py-1 text-label-sm font-medium ${cls} ${dim ? 'opacity-30' : ''}`}>{label}</div>;
}

/**
 * Team roster (Stitch "My Team & Department Roster") and the shift-swap desk.
 *
 * The server decides who is on the roster (your team, or the whole branch for an attendance
 * admin) and whether a swap is legal; the page collects the request and shows the answer.
 * Layout: four summary cards, a week navigator with a shift filter, the grid (a day picker on
 * phones), then swaps. The design's fixed "Slot 1-4 tiers" are the org's own shifts here.
 */
export default function TeamRosterShell({ actor }: Props) {
  const canRequest = can(actor, CAPABILITY.HR_ATTENDANCE_SWAP_REQUEST);
  const canDecide = can(actor, CAPABILITY.HR_ATTENDANCE_SWAP_APPROVE);
  const canOrgChart = can(actor, CAPABILITY.HR_EMPLOYEES_VIEW);

  const [from, setFrom] = useState<string | undefined>(undefined);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [mine, setMine] = useState<ShiftSwap[]>([]);
  // Who approvals go to. Needs the profile capability; without it the card falls back to the roster's supervisor.
  const [chain, setChain] = useState<ChainLink[]>([]);
  useEffect(() => { profileApi.mine().then((r) => setChain(r.data.chain)).catch(() => setChain([])); }, []);
  const [queue, setQueue] = useState<ShiftSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<{ peerId?: string; date?: string } | null>(null);
  const [rejecting, setRejecting] = useState<ShiftSwap | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const load = useCallback(() => {
    swaps.roster(from).then((r) => setRoster(r.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the roster.')).finally(() => setLoading(false));
    swaps.mine().then((r) => setMine(r.data)).catch(() => setMine([]));
    if (canDecide) swaps.queue().then((r) => setQueue(r.data)).catch(() => setQueue([]));
  }, [from, canDecide]);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setError(null); setNotice(null); setBusyId(id);
    try { await fn(); setNotice(done); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusyId(null); }
  };

  const today = todayLocal();
  const week = roster?.week_start;
  const dates = useMemo(() => (week ? Array.from({ length: 7 }, (_, i) => addDays(week, i)) : []), [week]);
  // The day the cards describe: today if it is in this week, else the week's first day.
  const focus = dates.includes(today) ? today : (dates[0] ?? today);
  const selectedDay = pickedDay && dates.includes(pickedDay) ? pickedDay : focus;

  const shiftNames = useMemo(() => {
    const set = new Set<string>();
    for (const p of roster?.people ?? []) for (const d of p.days) if (d.kind === 'shift' && d.shift_name) set.add(d.shift_name);
    return [...set].sort();
  }, [roster]);
  const styleFor = (name: string) => SHIFT_STYLE[Math.max(0, shiftNames.indexOf(name)) % SHIFT_STYLE.length]!;

  const dayOf = (p: RosterPerson, date: string) => p.days.find((d) => d.date === date);
  const focusCounts = useMemo(() => {
    const c = { working: 0, off: 0, leave: 0, none: 0, byShift: new Map<string, number>() };
    for (const p of roster?.people ?? []) {
      const d = dayOf(p, focus);
      if (!d) continue;
      if (d.kind === 'shift') { c.working += 1; c.byShift.set(d.shift_name!, (c.byShift.get(d.shift_name!) ?? 0) + 1); }
      else if (d.kind === 'leave') c.leave += 1;
      else if (d.kind === 'none') c.none += 1;
      else c.off += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, focus]);

  const anyShift = shiftNames.length > 0;
  const iAmPeerPending = mine.filter((s) => s.status === 'pending_peer' && s.peer_id === actor.id);
  const openSwaps = mine.filter((s) => s.status === 'pending_peer' || s.status === 'pending_manager');
  const dim = (d: RosterDay) => filter !== 'all' && !(d.kind === 'shift' && d.shift_name === filter);
  const canSwapCell = (p: RosterPerson, d: RosterDay) => canRequest && !p.is_me && d.kind === 'shift' && d.date > today;

  const exportCsv = () => {
    if (!roster) return;
    exportRows(
      roster.people,
      [{ header: 'Teammate', value: (p: RosterPerson) => p.full_name }, ...dates.map((date) => ({ header: `${dow(date)} ${shortDate(date)}`, value: (p: RosterPerson) => { const d = dayOf(p, date); return d ? cellText(d) : ''; } }))],
      `roster-${roster.week_start}`,
      'csv',
    );
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="My team"
        subtitle="Who works which shift this week, and shift swaps with teammates."
        actions={
          <>
            {canOrgChart && <Link href="/org-chart" className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant shadow-sm hover:border-primary hover:text-primary">Org chart</Link>}
            <Button variant="secondary" onClick={exportCsv} disabled={!roster || roster.people.length === 0}>Export</Button>
            {canRequest && <Button variant="primary" onClick={() => setRequesting({})}>Request swap</Button>}
          </>
        }
      />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {roster && (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <SummaryCard title="Team members" accent="bg-primary">
              <p className="font-mono text-headline-lg font-bold tabular-nums text-on-surface">{roster.people.length}</p>
              <p className="text-label-sm text-on-surface-variant">
                {focusCounts.working} working · {focusCounts.off} off · {focusCounts.leave} on leave
                <span className="block opacity-80">{focus === today ? 'today' : `on ${shortDate(focus)}`}</span>
              </p>
            </SummaryCard>

            <SummaryCard title="Shift mix" accent="bg-status-success">
              {focusCounts.working === 0 ? (
                <p className="text-label-sm text-on-surface-variant">No one is on a shift {focus === today ? 'today' : `on ${shortDate(focus)}`}.</p>
              ) : (
                <>
                  <div className="flex h-2 overflow-hidden rounded-full bg-surface-container" role="img" aria-label="Shift distribution">
                    {[...focusCounts.byShift].map(([name, n]) => <span key={name} style={{ width: `${(n / focusCounts.working) * 100}%`, backgroundColor: styleFor(name).dot }} />)}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-label-sm text-on-surface-variant">
                    {[...focusCounts.byShift].map(([name, n]) => (
                      <li key={name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: styleFor(name).dot }} aria-hidden="true" />{name}: <span className="font-semibold text-on-surface">{n}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </SummaryCard>

            <SummaryCard title="Swap tickets" accent="bg-status-due">
              <p className="font-mono text-headline-lg font-bold tabular-nums text-on-surface">{openSwaps.length}</p>
              <p className="text-label-sm text-on-surface-variant">
                {openSwaps.length === 0 ? 'No open swaps' : `${iAmPeerPending.length} waiting for you · ${openSwaps.length - iAmPeerPending.length} with others`}
              </p>
            </SummaryCard>

            <SummaryCard title="Supervisor" accent="bg-status-info">
              {roster.supervisor ? (
                <>
                  <p className="truncate text-sm font-semibold text-on-surface">{roster.supervisor.full_name}</p>
                  <p className="truncate text-label-sm text-on-surface-variant">{roster.supervisor.designation_name ?? 'Reporting manager'}</p>
                </>
              ) : (
                <p className="text-label-sm text-on-surface-variant">No reporting manager on record.</p>
              )}
            </SummaryCard>
          </div>
        )}

        {iAmPeerPending.length > 0 && (
          <PageSection title="Waiting for your answer">
            <ul className="grid gap-3 md:grid-cols-2">
              {iAmPeerPending.map((s) => (
                <li key={s.id} className="rounded-xl border border-status-due/30 bg-status-due-container p-4">
                  <p className="text-sm font-semibold text-on-status-due-container">{s.requester_name} wants to swap {formatDay(s.swap_date)}</p>
                  <p className="text-xs text-on-status-due-container">Their {s.requester_shift} for your {s.peer_shift} — “{s.reason}”</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="danger" disabled={busyId === s.id} onClick={() => void act(s.id, () => swaps.respond(s.id, false), 'Swap declined.')}>Decline</Button>
                    <Button variant="primary" disabled={busyId === s.id} onClick={() => void act(s.id, () => swaps.respond(s.id, true), 'Accepted — it now goes to the approver.')}>Accept</Button>
                  </div>
                </li>
              ))}
            </ul>
          </PageSection>
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-1 shadow-sm">
              <button type="button" aria-label="Previous week" onClick={() => setFrom(week ? addDays(week, -7) : undefined)} className="rounded-lg px-2.5 py-1.5 text-sm text-on-surface-variant hover:bg-surface-container">‹</button>
              <span className="min-w-40 px-2 text-center text-sm font-semibold tabular-nums text-on-surface">{roster ? `${shortDate(roster.week_start)} – ${shortDate(roster.week_end)} ${roster.week_end.slice(0, 4)}` : '…'}</span>
              <button type="button" aria-label="Next week" onClick={() => setFrom(week ? addDays(week, 7) : undefined)} className="rounded-lg px-2.5 py-1.5 text-sm text-on-surface-variant hover:bg-surface-container">›</button>
              <Button variant="ghost" onClick={() => { setFrom(undefined); setPickedDay(null); }}>Today</Button>
            </div>
            {anyShift && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by shift">
                <span className="text-label-sm uppercase tracking-wide text-on-surface-variant">Shift</span>
                {(['all', ...shiftNames] as const).map((name) => (
                  <button key={name} type="button" aria-pressed={filter === name} onClick={() => setFilter(name)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${filter === name ? 'border-primary bg-primary-fixed text-on-primary-fixed' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`}>
                    {name !== 'all' && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: styleFor(name).dot }} aria-hidden="true" />}
                    {name === 'all' ? 'All shifts' : name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading ? (
            <div className={stateBlockCls}>Loading…</div>
          ) : !roster || roster.people.length === 0 ? (
            <p className={emptyBlockCls}>No team members to show.</p>
          ) : (
            <>
              {!anyShift && (
                <div role="status" className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
                  No shifts are assigned for this week, so only weekly offs, holidays and leave are shown. Shifts are assigned by your administrator under Attendance admin → Shift assignments.
                </div>
              )}

              {/* Phone: pick a day, see everyone's shift that day (7 rows per person was a very long scroll). */}
              <div className="md:hidden">
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Day of the week">
                  {dates.map((date) => (
                    <button key={date} type="button" role="tab" aria-selected={selectedDay === date} onClick={() => setPickedDay(date)}
                      className={`flex w-12 shrink-0 flex-col items-center rounded-xl border px-1 py-1.5 text-xs transition-colors ${selectedDay === date ? 'border-primary bg-primary text-on-primary' : date === today ? 'border-primary bg-primary-fixed text-on-primary-fixed' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant'}`}>
                      <span className="text-label-sm">{dow(date)}</span>
                      <span className="font-mono text-sm font-bold tabular-nums">{dom(date)}</span>
                    </button>
                  ))}
                </div>
                <ul className="mt-1 divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
                  {roster.people.map((p) => {
                    const d = dayOf(p, selectedDay);
                    if (!d) return null;
                    const swappable = canSwapCell(p, d);
                    return (
                      <li key={p.user_id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${p.is_me ? 'bg-primary-fixed/30' : ''}`}>
                        <p className="min-w-0 truncate text-sm font-medium text-on-surface">{p.full_name}{p.is_me && <span className="ml-2 text-label-sm text-primary">You</span>}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="w-36"><Cell day={d} styleFor={styleFor} dim={dim(d)} /></div>
                          {swappable && <button type="button" onClick={() => setRequesting({ peerId: p.user_id, date: d.date })} className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed">Swap</button>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm md:block">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                      <th className="px-4 py-3">Teammate</th>
                      {dates.map((date) => (
                        <th key={date} className={`px-2 py-2 text-center ${date === today ? 'bg-primary-fixed text-on-primary-fixed' : ''}`}>
                          <span className="block text-label-sm">{dow(date)}</span>
                          <span className="block font-mono text-sm tabular-nums">{dom(date)}</span>
                          {date === today && <span className="block text-label-sm normal-case">Today</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.people.map((p) => (
                      <tr key={p.user_id} className={`border-b border-outline-variant/50 align-top last:border-0 ${p.is_me ? 'bg-primary-fixed/30' : ''}`}>
                        <td className="px-4 py-2 font-medium text-on-surface"><span className="flex items-center gap-2.5"><PersonAvatar name={p.full_name} userId={p.user_id} size="sm" /><span className="min-w-0 truncate">{p.full_name}{p.is_me && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-label-sm font-semibold text-on-primary">YOU</span>}</span></span></td>
                        {p.days.map((d) => (
                          <td key={d.date} className={`px-1.5 py-2 ${d.date === today ? 'bg-primary-fixed/20' : ''}`}>
                            {canSwapCell(p, d) ? (
                              <button type="button" title="Request a swap for this day" onClick={() => setRequesting({ peerId: p.user_id, date: d.date })} className="block w-full text-left transition-opacity hover:opacity-80">
                                <Cell day={d} styleFor={styleFor} dim={dim(d)} />
                              </button>
                            ) : <Cell day={d} styleFor={styleFor} dim={dim(d)} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {anyShift && (
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label-sm text-on-surface-variant" aria-label="Legend">
                  {shiftNames.map((n) => <li key={n} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: styleFor(n).dot }} aria-hidden="true" />{n}</li>)}
                  <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-outline-variant" aria-hidden="true" />Weekly off</li>
                  <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--color-cat-purple)' }} aria-hidden="true" />Holiday</li>
                  <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--color-status-info)' }} aria-hidden="true" />On leave</li>
                  {canRequest && <li className="ml-auto opacity-80">Tap a teammate’s shift to ask for a swap</li>}
                </ul>
              )}
            </>
          )}
        </section>

        {canDecide && (
          <PageSection title={`Swaps awaiting approval (${queue.length})`}>
            {queue.length === 0 ? (
              <p className={emptyBlockCls}>No swaps waiting for you.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {queue.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
                    <p className="text-sm font-semibold text-on-surface">{s.requester_name} ⇄ {s.peer_name}</p>
                    <p className="text-xs text-on-surface-variant">{formatDay(s.swap_date)} · {s.requester_shift} ⇄ {s.peer_shift}</p>
                    <p className="line-clamp-2 text-xs text-on-surface-variant">{s.reason}</p>
                    <div className="mt-auto flex justify-end gap-2 pt-1">
                      <Button variant="danger" disabled={busyId === s.id} onClick={() => setRejecting(s)}>Reject</Button>
                      <Button variant="primary" disabled={busyId === s.id} onClick={() => void act(s.id, () => swaps.approve(s.id), 'Swap approved — both rosters updated.')}>Approve</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <PageSection
          title="Peer shift swap & handover desk"
          action={canRequest ? <Button variant="primary" onClick={() => setRequesting({})}>+ New swap ticket</Button> : undefined}
        >
          {mine.length === 0 ? (
            <p className={emptyBlockCls}>No shift swaps yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {mine.map((s) => <SwapTicket key={s.id} swap={s} meId={actor.id} busy={busyId === s.id} onWithdraw={() => void act(s.id, () => swaps.cancel(s.id), 'Swap withdrawn.')} />)}
            </ul>
          )}
        </PageSection>
        <LeadershipCard supervisor={roster?.supervisor ?? null} chain={chain} />
        </div>

        <PageSection title="All swap activity" >
          {mine.length === 0 ? (
            <p className={emptyBlockCls}>No shift swaps yet.</p>
          ) : (
            <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
              {mine.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface">{formatDay(s.swap_date)} · {s.requester_name} ⇄ {s.peer_name}</p>
                    <p className="text-xs text-on-surface-variant">{s.requester_shift} ⇄ {s.peer_shift}</p>
                    {s.status === 'rejected' && s.approver_comment && <p className="text-label-sm text-on-status-overdue-container">{s.approver_comment}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm font-medium text-on-surface-variant">{SWAP_STATUS_LABEL[s.status] ?? s.status}</span>
                    {s.requester_id === actor.id && (s.status === 'pending_peer' || s.status === 'pending_manager') && (
                      <button type="button" disabled={busyId === s.id} onClick={() => void act(s.id, () => swaps.cancel(s.id), 'Swap withdrawn.')} className="rounded-lg px-2 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:opacity-50">Withdraw</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </PageBody>

      {requesting && roster && (
        <RequestModal roster={roster} initial={requesting} meId={actor.id} onClose={() => setRequesting(null)}
          onDone={() => { setRequesting(null); setNotice('Swap requested — your teammate has to agree first.'); load(); }} />
      )}
      {rejecting && (
        <RejectModal swap={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); setNotice('Swap rejected.'); load(); }} />
      )}
    </div>
  );
}

function SummaryCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm sm:p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden="true" />
      <p className="mb-1 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{title}</p>
      {children}
    </div>
  );
}

function RequestModal({ roster, initial, meId, onClose, onDone }: {
  roster: Roster;
  initial: { peerId?: string; date?: string };
  meId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [peerId, setPeerId] = useState(initial.peerId ?? '');
  const [date, setDate] = useState(initial.date ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!peerId || !date || !reason.trim()) { setError('Pick a teammate, a day and say why.'); return; }
    setBusy(true);
    try { await swaps.create({ peer_id: peerId, swap_date: date, reason: reason.trim() }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not request the swap.'); }
    finally { setBusy(false); }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">Cancel</button>
      <button type="button" onClick={submit} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60">{busy ? 'Sending…' : 'Send request'}</button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Request a shift swap" locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <p className="text-xs text-on-surface-variant">You take their shift and they take yours, for one future day. They must agree, then your approver signs off. A minimum 11-hour rest is checked for both of you.</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sw-peer" className={fieldLabelCls}>Teammate</label>
          <select id="sw-peer" value={peerId} onChange={(e) => setPeerId(e.target.value)} className={fieldInputCls} disabled={busy}>
            <option value="">Choose…</option>
            {roster.people.filter((p) => p.user_id !== meId).map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sw-date" className={fieldLabelCls}>Day</label>
          <input id="sw-date" type="date" min={addDays(todayLocal(), 1)} value={date} onChange={(e) => setDate(e.target.value)} className={fieldInputCls} disabled={busy} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="sw-reason" className={fieldLabelCls}>Why?</label>
            <SpeechInputButton onText={(t) => setReason((p) => appendDictation(p, t, 500))} disabled={busy} />
          </div>
          <textarea id="sw-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({ swap, onClose, onDone }: { swap: ShiftSwap; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!comment.trim()) { setError('A comment is required when rejecting.'); return; }
    setBusy(true);
    try { await swaps.reject(swap.id, comment.trim()); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reject.'); }
    finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={submit} disabled={busy} className="rounded-xl bg-status-overdue px-4 py-2 text-sm font-semibold text-on-status-overdue disabled:opacity-60">{busy ? 'Working…' : 'Reject'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Reject swap: ${swap.requester_name} ⇄ ${swap.peer_name}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-2">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <label htmlFor="rj-comment" className={fieldLabelCls}>Comment (required)</label>
        <textarea id="rj-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
      </div>
    </Modal>
  );
}

const timeAgo = (iso: string): string => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins || 1}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

/** One swap as a ticket: both slots side by side, where it stands in the two-step sign-off, and Withdraw while it is open. */
function SwapTicket({ swap, meId, busy, onWithdraw }: { swap: ShiftSwap; meId: string; busy: boolean; onWithdraw: () => void }) {
  const open = swap.status === 'pending_peer' || swap.status === 'pending_manager';
  const consented = swap.status !== 'pending_peer' && swap.status !== 'declined';
  const tone = swap.status === 'approved' ? 'bg-status-success-container text-on-status-success-container'
    : swap.status === 'rejected' || swap.status === 'declined' ? 'bg-status-overdue-container text-on-status-overdue-container'
    : open ? 'bg-status-due-container text-on-status-due-container' : 'bg-surface-container text-on-surface-variant';
  const mineIsRequester = swap.requester_id === meId;
  return (
    <li className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-on-surface-variant">
          <span className="rounded bg-primary-fixed px-1.5 py-0.5 font-mono font-semibold text-on-primary-fixed">SW-{swap.id.slice(-4).toUpperCase()}</span>
          Requested {timeAgo(swap.created_at)}
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-label-sm font-semibold ${tone}`}>{SWAP_STATUS_LABEL[swap.status] ?? swap.status}</span>
      </div>
      <div className="mt-3 grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-lg bg-surface-container-low px-3 py-2">
          <p className="text-label-sm text-on-surface-variant">{mineIsRequester ? 'Your slot' : `${swap.requester_name}'s slot`}</p>
          <p className="text-sm font-semibold text-on-surface">{swap.requester_shift}</p>
          <p className="text-label-sm text-on-surface-variant">{formatDay(swap.swap_date)}</p>
        </div>
        <span className="hidden text-lg text-primary sm:block" aria-hidden="true">⇄</span>
        <div className="rounded-lg bg-surface-container-low px-3 py-2">
          <p className="text-label-sm text-on-surface-variant">{mineIsRequester ? `Peer: ${swap.peer_name}` : 'Your slot'}</p>
          <p className="text-sm font-semibold text-on-surface">{swap.peer_shift}</p>
          <p className="text-label-sm text-on-surface-variant">{formatDay(swap.swap_date)}</p>
        </div>
      </div>
      {swap.reason && <p className="mt-2 text-xs text-on-surface-variant">Reason: {swap.reason}</p>}
      <ol className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-label-sm" aria-label="Sign-off progress">
        <li className={consented ? 'font-semibold text-on-status-success-container' : swap.status === 'declined' ? 'font-semibold text-on-status-overdue-container' : 'text-on-surface-variant'}>
          {consented ? '✓' : swap.status === 'declined' ? '✕' : '○'} Teammate {consented ? 'consented' : swap.status === 'declined' ? 'declined' : 'to agree'}
        </li>
        <li className={swap.status === 'approved' ? 'font-semibold text-on-status-success-container' : swap.status === 'rejected' ? 'font-semibold text-on-status-overdue-container' : 'text-on-surface-variant'}>
          {swap.status === 'approved' ? '✓' : swap.status === 'rejected' ? '✕' : '○'} Approver {swap.status === 'approved' ? 'approved' : swap.status === 'rejected' ? 'rejected' : 'sign-off'}
        </li>
      </ol>
      {swap.status === 'rejected' && swap.approver_comment && <p className="mt-1 text-label-sm text-on-status-overdue-container">{swap.approver_comment}</p>}
      {mineIsRequester && open && (
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={busy} onClick={onWithdraw} className="rounded-lg border border-status-overdue/40 px-3 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:opacity-50">Withdraw</button>
        </div>
      )}
    </li>
  );
}

/** Who approvals go to, nearest first, with a way to reach them. Built from the reporting chain; nothing is invented beyond it. */
function LeadershipCard({ supervisor, chain }: { supervisor: Roster['supervisor']; chain: ChainLink[] }) {
  const people = chain.length > 0
    ? chain.slice(0, 2).map((c, i) => ({ id: c.user_id, name: c.full_name, title: c.designation_name, email: c.email ?? null, role: i === 0 ? 'Direct reporting manager' : 'Secondary approver / head' }))
    : supervisor ? [{ id: supervisor.user_id, name: supervisor.full_name, title: supervisor.designation_name, email: null, role: 'Direct reporting manager' }] : [];
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <h3 className="text-base font-semibold text-on-surface">Leadership & escalation</h3>
      <p className="mb-3 text-xs text-on-surface-variant">Who signs off your swaps and leave</p>
      {people.length === 0 ? <p className="text-sm text-on-surface-variant">No reporting manager on record. Ask HR to set one.</p> : (
        <ul className="space-y-3">
          {people.map((p) => (
            <li key={p.id} className="rounded-lg bg-surface-container-low p-3">
              <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{p.role}</p>
              <div className="mt-1.5 flex items-center gap-2.5">
                <PersonAvatar name={p.name} userId={p.id} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-on-surface">{p.name}</p>
                  {p.title && <p className="truncate text-label-sm text-on-surface-variant">{p.title}</p>}
                </div>
              </div>
              {p.email && <a href={`mailto:${p.email}`} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">Email {p.name.split(' ')[0]}</a>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
