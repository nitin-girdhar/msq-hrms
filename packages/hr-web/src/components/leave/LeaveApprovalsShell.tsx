'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { can, CAPABILITY } from '@platform/rbac';
import { leave as leaveApi } from '../../lib/api/client';
import type { BulkLeaveOutcome, LeaveRequestView } from '../../lib/leave/types';
import { formatDateRange, formatDays, formatDateTime } from '../../lib/leave/format';
import { emptyBlockCls, stateBlockCls } from '../../lib/ui';
import type { HrRank } from '../../lib/hr-rank';
import LeaveTabs from './LeaveTabs';
import TeamLeaveCalendar from './TeamLeaveCalendar';
import ApprovalDecisionModal from './ApprovalDecisionModal';
import BulkLeaveDecisionModal from './BulkLeaveDecisionModal';
import CompOffQueue from './CompOffQueue';
import RequestInfoModal from './RequestInfoModal';
import { EncashmentQueue } from './EncashmentPanel';
import { slaState } from '../../lib/h7/types';
import StatCard from '../common/StatCard';
import StatusPill from '../common/StatusPill';
import PersonAvatar from '../common/PersonAvatar';
import ApprovalProgress from '../shared/ApprovalProgress';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

export default function LeaveApprovalsShell({ actor, hrRank }: Props) {
  const [pending, setPending] = useState<LeaveRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<LeaveRequestView | null>(null);
  const [asking, setAsking] = useState<LeaveRequestView | null>(null);
  const [tab, setTab] = useState<'queue' | 'claims' | 'calendar'>('queue');
  const showClaims = can(actor, CAPABILITY.HR_LEAVE_COMP_OFF_APPROVE) || can(actor, CAPABILITY.HR_LEAVE_ENCASHMENT_APPROVE);
  // Selected request ids for the bulk bar, and the decision awaiting confirmation.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDecision, setBulkDecision] = useState<'approve' | 'reject' | null>(null);
  // Queue filter: everything, only requests near/over their approval window, or one leave type.
  const [filter, setFilter] = useState<'all' | 'urgent' | string>('all');
  const [ledger, setLedger] = useState<LeaveRequestView[]>([]);
  const [awayToday, setAwayToday] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    leaveApi
      .teamRequests({ status: 'pending', limit: 100 })
      .then((res) => {
        setPending(res.data);
        // Drop selections that are no longer pending (decided by this or another approver).
        setSelected((prev) => new Set([...prev].filter((id) => res.data.some((r) => r.id === id))));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the approval queue.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // The header numbers and the ledger: the team's latest decisions, and who is on approved leave today.
  const loadContext = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      leaveApi.teamRequests({ status: 'approved', limit: 100 }),
      leaveApi.teamRequests({ status: 'rejected', limit: 20 }),
    ])
      .then(([ok, no]) => {
        setAwayToday(new Set(ok.data.filter((r) => r.start_date <= today && r.end_date >= today).map((r) => r.user_id)).size);
        setLedger([...ok.data, ...no.data].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5));
      })
      .catch(() => { setAwayToday(null); setLedger([]); });
  }, []);
  useEffect(() => { loadContext(); }, [loadContext]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const isUrgent = (r: LeaveRequestView) => { const sla = slaState(r.created_at, r.sla_hours); return sla?.tone === 'due' || sla?.tone === 'overdue'; };
  const urgentCount = pending.filter(isUrgent).length;
  const typeChips = Array.from(new Set(pending.map((r) => r.leave_type_label))).sort();
  const shown = filter === 'all' ? pending : filter === 'urgent' ? pending.filter(isUrgent) : pending.filter((r) => r.leave_type_label === filter);
  const allSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const selectedRequests = pending.filter((r) => selected.has(r.id));

  // Skipped requests are named with their reason: a bare "3 of 5" would leave the
  // approver guessing which two still need attention.
  const handleBulkDone = (outcome: BulkLeaveOutcome) => {
    const verb = outcome.decision === 'approve' ? 'approved' : 'rejected';
    const skipped = outcome.results.filter((r) => !r.ok);
    if (skipped.length === 0) {
      setNotice(`${outcome.succeeded} request${outcome.succeeded === 1 ? '' : 's'} ${verb}.`);
      setError(null);
    } else {
      setNotice(outcome.succeeded > 0 ? `${outcome.succeeded} ${verb}.` : null);
      const names = new Map(pending.map((r) => [r.id, r.user_full_name]));
      setError(`${skipped.length} skipped: ` + skipped.map((s) => `${names.get(s.request_id) ?? 'request'} (${s.error ?? 'failed'})`).join('; '));
    }
    setSelected(new Set());
    load();
    loadContext();
  };

  const handleDecided = (message: string) => {
    setNotice(message);
    load();
    loadContext();
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Leave Approvals"
        info="Pending requests awaiting your decision, and your team’s approved leave."
        tabs={<LeaveTabs hrRank={hrRank} actor={actor} />}
      />

      <PageBody dense>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Pending approvals" value={pending.length} tone={urgentCount > 0 ? 'overdue' : 'primary'}
            hint={urgentCount > 0 ? `${urgentCount} near or past the approval window` : 'none near the approval window'} />
          <StatCard label="Team away today" value={awayToday ?? '—'} tone="info" hint="people on approved leave" />
          <StatCard label="Recently decided" value={ledger.length} tone="success" hint="latest team decisions, below" />
        </div>

        <div className="flex gap-1 border-b border-outline-variant" role="tablist">
          {([['queue', `Approvals (${pending.length})`], ...(showClaims ? [['claims', 'Comp-off & encashment']] : []), ['calendar', 'Team availability']] as Array<['queue' | 'claims' | 'calendar', string]>).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'queue' && (
        <PageSection title={`Pending approvals (${pending.length})`}>
        {loading ? (
          <div className={stateBlockCls}>Loading…</div>
        ) : pending.length === 0 ? (
          <p className={emptyBlockCls}>Nothing awaiting approval. You’re all caught up.</p>
        ) : (
          // Card per request (Stitch approvals queue): everything the approver needs
          // to decide — who, what, how long, why — without opening the modal first.
          <>
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter the queue">
            {([['all', `All (${pending.length})`], ['urgent', `Urgent SLA (${urgentCount})`], ...typeChips.map((t) => [t, `${t} (${pending.filter((r) => r.leave_type_label === t).length})`])] as Array<[string, string]>).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${filter === key ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`}>{label}</button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((r) => r.id)))}
                className="h-4 w-4 rounded border-outline-variant accent-primary"
              />
              Select all ({shown.length})
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-on-surface-variant">{selected.size} selected</span>
                <Button variant="danger" onClick={() => setBulkDecision('reject')}>Reject</Button>
                <Button variant="primary" onClick={() => setBulkDecision('approve')}>Approve</Button>
              </div>
            )}
          </div>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((r) => (
              <li key={r.id} className={`flex flex-col gap-2 rounded-xl border bg-surface-container-lowest p-4 shadow-sm ${selected.has(r.id) ? 'border-primary ring-1 ring-primary/30' : 'border-outline-variant'}`}>
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.user_full_name}'s request`}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-outline-variant accent-primary"
                  />
                  <PersonAvatar name={r.user_full_name} userId={r.user_id} size="sm" />
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{r.user_full_name}</p>
                    <p className="truncate text-label-sm text-outline">{r.user_email}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-status-due-container px-2 py-0.5 text-label-sm font-semibold text-on-status-due-container">
                    {r.leave_type_label}
                  </span>
                  </div>
                </div>
                <p className="text-sm text-on-surface">
                  {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
                  <span className="text-on-surface-variant"> · {formatDays(r.days_count)}</span>
                </p>
                {r.reason && <p className="line-clamp-2 text-xs text-on-surface-variant">{r.reason}</p>}
                <ApprovalProgress data={r} status={r.status_name} />
                {r.handover_name && <p className="text-xs text-on-surface-variant">Work handover: <strong className="text-on-surface">{r.handover_name}</strong></p>}
                {r.attachment_name && <a href={leaveApi.attachmentUrl(r.id)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-primary hover:underline">📎 {r.attachment_name}</a>}
                {(() => {
                  const sla = slaState(r.created_at, r.sla_hours);
                  const cls = sla?.tone === 'overdue' ? 'bg-status-overdue-container text-on-status-overdue-container' : sla?.tone === 'due' ? 'bg-status-due-container text-on-status-due-container' : 'bg-surface-container text-on-surface-variant';
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {sla && <span className={`rounded-full px-2 py-0.5 text-label-sm font-semibold ${cls}`}>{sla.label}</span>}
                      {r.info_requested_at && <span className="rounded-full bg-status-info-container px-2 py-0.5 text-label-sm font-semibold text-on-status-info-container">Waiting for their answer</span>}
                    </div>
                  );
                })()}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-label-sm text-outline">Applied {formatDateTime(r.created_at)}</span>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => { setAsking(r); setNotice(null); }}>Ask</Button>
                    <Button variant="primary" onClick={() => { setReviewing(r); setNotice(null); }}>Review</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
        </PageSection>
        )}

        {tab === 'queue' && ledger.length > 0 && (
          <PageSection title="Recent decision ledger">
            <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    <th className="px-4 py-2.5">Employee</th><th className="px-4 py-2.5">Type &amp; duration</th><th className="px-4 py-2.5">Dates</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Decided</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={r.id} className="border-b border-outline-variant/50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-on-surface">{r.user_full_name}</td>
                      <td className="px-4 py-2.5 text-on-surface-variant">{r.leave_type_label} · {formatDays(r.days_count)}</td>
                      <td className="px-4 py-2.5 text-on-surface-variant">{formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}</td>
                      <td className="px-4 py-2.5"><StatusPill tone={r.status_name === 'approved' ? 'success' : 'overdue'}>{r.status_label}</StatusPill></td>
                      <td className="px-4 py-2.5 text-xs text-on-surface-variant">{formatDateTime(r.latest_approval_acted_at ?? r.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PageSection>
        )}

        {tab === 'claims' && showClaims && (
          <>
            {can(actor, CAPABILITY.HR_LEAVE_COMP_OFF_APPROVE) && (
              <PageSection title="Comp-off claims">
                <CompOffQueue onNotice={setNotice} onError={setError} />
              </PageSection>
            )}
            {can(actor, CAPABILITY.HR_LEAVE_ENCASHMENT_APPROVE) && (
              <PageSection title="Encashment requests">
                <EncashmentQueue onNotice={setNotice} onError={setError} />
              </PageSection>
            )}
          </>
        )}

        {tab === 'calendar' && (
          <PageSection title="Team availability">
            <TeamLeaveCalendar />
          </PageSection>
        )}
      </PageBody>

      <BulkLeaveDecisionModal
        requests={bulkDecision ? selectedRequests : null}
        decision={bulkDecision ?? 'approve'}
        onClose={() => setBulkDecision(null)}
        onDone={handleBulkDone}
      />
      {asking && <RequestInfoModal request={asking} onClose={() => setAsking(null)} onSent={() => { setAsking(null); setNotice('Question sent. The request stays pending until they answer.'); load(); }} />}
      <ApprovalDecisionModal request={reviewing} onClose={() => setReviewing(null)} onDecided={handleDecided} />
    </div>
  );
}
