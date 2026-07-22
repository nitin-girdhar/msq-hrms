'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
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
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="My Leave"
        subtitle={`Balances, requests and approvals for ${actor.name || actor.email}.`}
        tabs={<LeaveTabs hrRank={hrRank} actor={actor} />}
        actions={
          <Button variant="primary" onClick={() => { setApplyOpen(true); setNotice(null); }}>
            Apply leave
          </Button>
        }
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <PageSection title="Balances">
          <BalanceCards balances={balances} />
        </PageSection>

        <PageSection
          title="My requests"
          action={
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            >
              {LEAVE_STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          }
        >
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
          ) : (
            <MyRequestsTable items={requests} onCancel={handleCancel} busyId={cancelBusyId} />
          )}
        </PageSection>
      </PageBody>

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
