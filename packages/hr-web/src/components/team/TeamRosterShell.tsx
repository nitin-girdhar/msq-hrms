'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, Button, Modal, PageBody, PageHeader, PageSection, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { swaps } from '../../lib/api/client';
import type { Roster, RosterDay, ShiftSwap } from '../../lib/team/types';
import { SWAP_STATUS_LABEL } from '../../lib/team/types';
import { formatDay } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

interface Props {
  actor: SessionUser;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (iso: string) => DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const dom = (iso: string) => String(Number(iso.slice(8, 10)));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** One roster cell. Colour carries state through fixed status tokens, never the brand. */
function Cell({ day }: { day: RosterDay }) {
  if (day.kind === 'shift') {
    return (
      <div className="rounded-lg bg-primary-fixed px-2 py-1 text-label-sm text-on-primary-fixed">
        <p className="font-semibold">{day.shift_name}</p>
        <p className="tabular-nums opacity-80">{day.start}–{day.end}</p>
      </div>
    );
  }
  const map = {
    off: ['Weekly off', 'bg-surface-container text-on-surface-variant'],
    holiday: ['Holiday', 'bg-cat-purple-container text-on-cat-purple-container'],
    leave: ['On leave', 'bg-status-info-container text-on-status-info-container'],
    none: ['No shift', 'bg-surface-container-low text-outline'],
  } as const;
  const [label, cls] = map[day.kind as keyof typeof map];
  return <div className={`rounded-lg px-2 py-1 text-label-sm font-medium ${cls}`}>{label}</div>;
}

/**
 * Team roster (Stitch "My Team & Department Roster") and the shift-swap desk. The
 * server decides who is on the roster (your team, or the whole branch for an
 * attendance admin) and whether a swap is legal; the page only collects the
 * request and shows the answer.
 */
export default function TeamRosterShell({ actor }: Props) {
  const canRequest = can(actor, CAPABILITY.HR_ATTENDANCE_SWAP_REQUEST);
  const canDecide = can(actor, CAPABILITY.HR_ATTENDANCE_SWAP_APPROVE);

  const [from, setFrom] = useState<string | undefined>(undefined);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [mine, setMine] = useState<ShiftSwap[]>([]);
  const [queue, setQueue] = useState<ShiftSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<{ peerId?: string; date?: string } | null>(null);
  const [rejecting, setRejecting] = useState<ShiftSwap | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    swaps.roster(from).then((r) => setRoster(r.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the roster.')).finally(() => setLoading(false));
    swaps.mine().then((r) => setMine(r.data)).catch(() => setMine([]));
    if (canDecide) swaps.queue().then((r) => setQueue(r.data)).catch(() => setQueue([]));
  }, [from, canDecide]);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setNotice(null);
    setBusyId(id);
    try {
      await fn();
      setNotice(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusyId(null);
    }
  };

  const week = roster?.week_start;
  const iAmPeerPending = mine.filter((s) => s.status === 'pending_peer' && s.peer_id === actor.id);

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="My team"
        subtitle="Who works which shift this week, and shift swaps with teammates."
        actions={
          <>
            <Button variant="secondary" onClick={() => setFrom(week ? addDays(week, -7) : undefined)}>← Prev</Button>
            <Button variant="secondary" onClick={() => setFrom(undefined)}>This week</Button>
            <Button variant="secondary" onClick={() => setFrom(week ? addDays(week, 7) : undefined)}>Next →</Button>
            {canRequest && <Button variant="primary" onClick={() => setRequesting({})}>Request swap</Button>}
          </>
        }
      />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

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

        <PageSection title={roster ? `Week of ${formatDay(roster.week_start)}` : 'Roster'}>
          {loading ? (
            <div className={stateBlockCls}>Loading…</div>
          ) : !roster || roster.people.length === 0 ? (
            <p className={emptyBlockCls}>No team members to show.</p>
          ) : (
            <>
              {/* Phone: one card per person, days stacked. */}
              <ul className="flex flex-col gap-2 md:hidden">
                {roster.people.map((p) => (
                  <li key={p.user_id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
                    <p className="text-sm font-semibold text-on-surface">{p.full_name}{p.is_me && <span className="ml-2 text-label-sm text-primary">You</span>}</p>
                    <ul className="mt-2 space-y-1">
                      {p.days.map((d) => (
                        <li key={d.date} className="flex items-center gap-3">
                          <span className="w-12 shrink-0 text-label-sm text-on-surface-variant">{dow(d.date)} {dom(d.date)}</span>
                          <div className="min-w-0 flex-1"><Cell day={d} /></div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm md:block">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                      <th className="px-4 py-3">Teammate</th>
                      {roster.people[0]!.days.map((d) => <th key={d.date} className="px-2 py-3">{dow(d.date)} {dom(d.date)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.people.map((p) => (
                      <tr key={p.user_id} className="border-b border-outline-variant/50 align-top last:border-0">
                        <td className="px-4 py-2 font-medium text-on-surface">{p.full_name}{p.is_me && <span className="ml-2 text-label-sm text-primary">You</span>}</td>
                        {p.days.map((d) => {
                          // A swap can be asked from any of a teammate's shift cells on a future day.
                          const swappable = canRequest && !p.is_me && d.kind === 'shift' && d.date > new Date().toISOString().slice(0, 10);
                          return (
                            <td key={d.date} className="px-1.5 py-2">
                              {swappable ? (
                                <button type="button" title="Request a swap for this day" onClick={() => setRequesting({ peerId: p.user_id, date: d.date })} className="block w-full text-left transition-opacity hover:opacity-80">
                                  <Cell day={d} />
                                </button>
                              ) : <Cell day={d} />}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </PageSection>

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

        <PageSection title="My swaps">
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
        <RequestModal
          roster={roster}
          initial={requesting}
          meId={actor.id}
          onClose={() => setRequesting(null)}
          onDone={() => { setRequesting(null); setNotice('Swap requested — your teammate has to agree first.'); load(); }}
        />
      )}
      {rejecting && (
        <RejectModal
          swap={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => { setRejecting(null); setNotice('Swap rejected.'); load(); }}
        />
      )}
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
    try {
      await swaps.create({ peer_id: peerId, swap_date: date, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request the swap.');
    } finally {
      setBusy(false);
    }
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
          <input id="sw-date" type="date" min={addDays(new Date().toISOString().slice(0, 10), 1)} value={date} onChange={(e) => setDate(e.target.value)} className={fieldInputCls} disabled={busy} />
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
