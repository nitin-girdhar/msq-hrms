'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveRequestView } from '../../lib/leave/types';
import { formatDateRange, formatDays, formatDateTime } from '../../lib/leave/format';
import { emptyBlockCls, stateBlockCls } from '../../lib/ui';
import type { HrRank } from '../../lib/hr-rank';
import LeaveTabs from './LeaveTabs';
import TeamLeaveCalendar from './TeamLeaveCalendar';
import ApprovalDecisionModal from './ApprovalDecisionModal';

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

  const load = useCallback(() => {
    setLoading(true);
    leaveApi
      .teamRequests({ status: 'pending', limit: 100 })
      .then((res) => setPending(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the approval queue.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDecided = (message: string) => {
    setNotice(message);
    load();
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Leave Approvals"
        subtitle="Pending requests awaiting your decision, and your team’s approved leave."
        tabs={<LeaveTabs hrRank={hrRank} actor={actor} />}
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <PageSection title={`Pending approvals (${pending.length})`}>
        {loading ? (
          <div className={stateBlockCls}>Loading…</div>
        ) : pending.length === 0 ? (
          <p className={emptyBlockCls}>Nothing awaiting approval. You’re all caught up.</p>
        ) : (
          // Card per request (Stitch approvals queue): everything the approver needs
          // to decide — who, what, how long, why — without opening the modal first.
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{r.user_full_name}</p>
                    <p className="truncate text-label-sm text-outline">{r.user_email}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-status-due-container px-2 py-0.5 text-label-sm font-semibold text-on-status-due-container">
                    {r.leave_type_label}
                  </span>
                </div>
                <p className="text-sm text-on-surface">
                  {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
                  <span className="text-on-surface-variant"> · {formatDays(r.days_count)}</span>
                </p>
                {r.reason && <p className="line-clamp-2 text-xs text-on-surface-variant">{r.reason}</p>}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-label-sm text-outline">Applied {formatDateTime(r.created_at)}</span>
                  <Button variant="primary" onClick={() => { setReviewing(r); setNotice(null); }}>
                    Review
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        </PageSection>

        <PageSection title="Team calendar">
          <TeamLeaveCalendar />
        </PageSection>
      </PageBody>

      <ApprovalDecisionModal request={reviewing} onClose={() => setReviewing(null)} onDecided={handleDecided} />
    </div>
  );
}
