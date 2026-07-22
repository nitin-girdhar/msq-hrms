'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveRequestView } from '../../lib/leave/types';
import { formatDateRange, formatDays, formatDateTime } from '../../lib/leave/format';
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
          <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
        ) : pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
            Nothing awaiting approval. You’re all caught up.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Applied</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#0F172A]">{r.user_full_name}</p>
                      <p className="text-[11px] text-[#94A3B8]">{r.user_email}</p>
                    </td>
                    <td className="px-4 py-3 text-[#475569]">{r.leave_type_label}</td>
                    <td className="px-4 py-3 text-[#475569]">
                      {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
                      {r.reason && <p className="mt-0.5 text-[11px] text-[#94A3B8]">{r.reason}</p>}
                    </td>
                    <td className="px-4 py-3 text-[#475569]">{formatDays(r.days_count)}</td>
                    <td className="px-4 py-3 text-[11px] text-[#94A3B8]">{formatDateTime(r.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="primary" onClick={() => { setReviewing(r); setNotice(null); }}>
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
