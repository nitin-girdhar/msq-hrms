'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveBalance, LeavePolicyView, LeaveRequestView } from '../../lib/leave/types';
import { LEAVE_STATUS_FILTERS } from '../../lib/leave/format';
import type { HrRank } from '../../lib/hr-rank';
import LeaveTabs from './LeaveTabs';
import BalanceCards from './BalanceCards';
import MyRequestsTable from './MyRequestsTable';
import ApplyLeaveModal from './ApplyLeaveModal';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

export default function LeaveDashboardShell({ actor, hrRank }: Props) {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [policies, setPolicies] = useState<LeavePolicyView[]>([]);
  const [requests, setRequests] = useState<LeaveRequestView[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  const loadStatic = useCallback(() => {
    Promise.all([leaveApi.balances(), leaveApi.policies()])
      .then(([bal, pol]) => {
        setBalances(bal.data);
        setPolicies(pol.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load leave data.'));
  }, []);

  const loadRequests = useCallback(() => {
    setLoading(true);
    leaveApi
      .myRequests({ status: statusFilter || undefined, limit: 100 })
      .then((res) => setRequests(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load requests.'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleApplied = () => {
    setNotice('Leave request submitted.');
    loadStatic();
    loadRequests();
  };

  const handleCancel = async (req: LeaveRequestView) => {
    setError(null);
    setNotice(null);
    setCancelBusyId(req.id);
    try {
      const res = await leaveApi.cancel(req.id);
      setNotice(res.data.reversed ? 'Leave cancelled and balance restored.' : 'Leave request cancelled.');
      loadStatic();
      loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel request.');
    } finally {
      setCancelBusyId(null);
    }
  };

  return (
    <div className="w-full space-y-6 px-3 py-4 sm:px-4">
      <LeaveTabs hrRank={hrRank} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">My Leave</h1>
          <p className="mt-1 text-sm text-[#64748B]">Balances, requests and approvals for {actor.name || actor.email}.</p>
        </div>
        <button
          type="button"
          onClick={() => { setApplyOpen(true); setNotice(null); }}
          className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699]"
        >
          Apply leave
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-700">{notice}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0b6cbf]">Balances</h2>
        <BalanceCards balances={balances} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0b6cbf]">My requests</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
          >
            {LEAVE_STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
        ) : (
          <MyRequestsTable items={requests} onCancel={handleCancel} busyId={cancelBusyId} />
        )}
      </section>

      <ApplyLeaveModal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        policies={policies}
        balances={balances}
        onApplied={handleApplied}
      />
    </div>
  );
}
