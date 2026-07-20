'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@crm/types';
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
    <div className="w-full space-y-6 px-3 py-4 sm:px-4">
      <AttendanceTabs hrRank={hrRank} />

      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Team Attendance</h1>
        <p className="mt-1 text-sm text-[#64748B]">Who’s in, who’s out, and pending regularization requests.</p>
      </div>

      {notice && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-700">{notice}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0b6cbf]">Day view</h2>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Select date"
            className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
          />
        </div>
        <TeamDayView rows={rows} loading={rowsLoading} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0b6cbf]">Pending regularizations ({pending.length})</h2>
        <RegularizationQueue items={pending} loading={pendingLoading} onReview={(r) => { setReviewing(r); setNotice(null); }} />
      </section>

      <RegularizationDecisionModal request={reviewing} onClose={() => setReviewing(null)} onDecided={handleDecided} />
    </div>
  );
}
