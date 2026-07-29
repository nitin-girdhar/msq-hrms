'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveBalance, LeaveRequestView } from '../../lib/leave/types';
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
  const [requests, setRequests] = useState<LeaveRequestView[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  // The pending request being amended; null means the modal is in apply mode.
  const [editing, setEditing] = useState<LeaveRequestView | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  // One call: /leave/balances carries everything an employee may see — the number
  // per leave type as of today, plus whether it is bookable and half-day-able.
  // The apply modal used to be fed from the admin policy list, which is why this
  // page 403'd for everyone below hr_manager.
  const loadStatic = useCallback(() => {
    leaveApi
      .balances()
      .then((res) => setBalances(res.data))
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
    // Fires for both modes; `editing` is still set when the modal saved an edit.
    setNotice(editing ? 'Leave request updated.' : 'Leave request submitted.');
    loadStatic();
    loadRequests();
  };

  const handleEdit = (req: LeaveRequestView) => {
    setNotice(null);
    setError(null);
    setEditing(req);
    setApplyOpen(true);
  };

  const closeModal = () => {
    setApplyOpen(false);
    setEditing(null);
  };

  const handleCancel = async (req: LeaveRequestView) => {
    setError(null);
    setNotice(null);
    setCancelBusyId(req.id);
    try {
      await leaveApi.cancel(req.id);
      setNotice('Leave request cancelled.');
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
          <Button variant="primary" onClick={() => { setEditing(null); setApplyOpen(true); setNotice(null); }}>
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
            <MyRequestsTable items={requests} onEdit={handleEdit} onCancel={handleCancel} busyId={cancelBusyId} />
          )}
        </PageSection>
      </PageBody>

      <ApplyLeaveModal
        open={applyOpen}
        onClose={closeModal}
        balances={balances}
        onApplied={handleApplied}
        editing={editing}
      />
    </div>
  );
}
