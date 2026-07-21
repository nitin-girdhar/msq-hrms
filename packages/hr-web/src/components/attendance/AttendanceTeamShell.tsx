'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { RegularizationView, TeamDayRow } from '../../lib/attendance/types';
import { todayIso } from '../../lib/attendance/format';
import type { HrRank } from '../../lib/hr-rank';
import AttendanceTabs from './AttendanceTabs';
import TeamDayView from './TeamDayView';
import RegularizationQueue from './RegularizationQueue';
import RegularizationDecisionModal from './RegularizationDecisionModal';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

export default function AttendanceTeamShell({ hrRank }: Props) {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<TeamDayRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [pending, setPending] = useState<RegularizationView[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<RegularizationView | null>(null);

  const loadRows = useCallback(() => {
    setRowsLoading(true);
    attendanceApi
      .team({ date })
      .then((res) => setRows(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the team view.'))
      .finally(() => setRowsLoading(false));
  }, [date]);

  const loadPending = useCallback(() => {
    setPendingLoading(true);
    attendanceApi.regularizations
      .list({ scope: 'team', status: 'pending', limit: 100 })
      .then((res) => setPending(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the approval queue.'))
      .finally(() => setPendingLoading(false));
  }, []);

  useEffect(() => { loadRows(); }, [loadRows]);
  useEffect(() => { loadPending(); }, [loadPending]);

  const handleDecided = (message: string) => {
    setNotice(message);
    loadPending();
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Team Attendance"
        subtitle="Who’s in, who’s out, and pending regularization requests."
        tabs={<AttendanceTabs hrRank={hrRank} />}
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <PageSection
          title="Day view"
          action={
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Select date"
              className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            />
          }
        >
          <TeamDayView rows={rows} loading={rowsLoading} />
        </PageSection>

        <PageSection title={`Pending regularizations (${pending.length})`}>
          <RegularizationQueue items={pending} loading={pendingLoading} onReview={(r) => { setReviewing(r); setNotice(null); }} />
        </PageSection>
      </PageBody>

      <RegularizationDecisionModal request={reviewing} onClose={() => setReviewing(null)} onDecided={handleDecided} />
    </div>
  );
}
