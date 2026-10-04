'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { can, CAPABILITY } from '@platform/rbac';
import { compOff as compOffApi, leave as leaveApi } from '../../lib/api/client';
import type { CompOffClaim, LeaveBalance, LeaveRequestView } from '../../lib/leave/types';
import { LEAVE_STATUS_FILTERS } from '../../lib/leave/format';
import type { HrRank } from '../../lib/hr-rank';
import { stateBlockCls } from '../../lib/ui';
import LeaveTabs from './LeaveTabs';
import BalanceCards from './BalanceCards';
import MyRequestsTable from './MyRequestsTable';
import ApplyLeaveModal from './ApplyLeaveModal';
import LeaveRequestDetailModal from './LeaveRequestDetailModal';
import CompOffClaimModal from './CompOffClaimModal';
import MyCompOffList from './MyCompOffList';

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
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Comp-off: shown only to someone who may claim it (the server enforces the same capability).
  const canClaimCompOff = can(actor, CAPABILITY.HR_LEAVE_COMP_OFF_REQUEST);
  const [claims, setClaims] = useState<CompOffClaim[]>([]);
  const [claimOpen, setClaimOpen] = useState(false);

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

  const loadClaims = useCallback(() => {
    if (!canClaimCompOff) return;
    compOffApi
      .mine()
      .then((res) => setClaims(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load comp-off claims.'));
  }, [canClaimCompOff]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { loadClaims(); }, [loadClaims]);
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
          <>
            {canClaimCompOff && (
              <Button variant="secondary" onClick={() => { setClaimOpen(true); setNotice(null); }}>
                Claim comp-off
              </Button>
            )}
            <Button variant="primary" onClick={() => { setEditing(null); setApplyOpen(true); setNotice(null); }}>
              Apply leave
            </Button>
          </>
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
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {LEAVE_STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          }
        >
          {loading ? (
            <div className={stateBlockCls}>Loading…</div>
          ) : (
            <MyRequestsTable items={requests} onView={(r) => setViewingId(r.id)} onEdit={handleEdit} onCancel={handleCancel} busyId={cancelBusyId} />
          )}
        </PageSection>

        {canClaimCompOff && (
          <PageSection title="Comp-off claims">
            <MyCompOffList
              items={claims}
              onChanged={() => { setNotice('Comp-off claim cancelled.'); loadClaims(); }}
              onError={setError}
            />
          </PageSection>
        )}
      </PageBody>

      <CompOffClaimModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        onClaimed={() => { setNotice('Comp-off claim submitted for approval.'); loadClaims(); }}
      />

      <ApplyLeaveModal
        open={applyOpen}
        onClose={closeModal}
        balances={balances}
        onApplied={handleApplied}
        editing={editing}
      />

      <LeaveRequestDetailModal requestId={viewingId} onClose={() => setViewingId(null)} />
    </div>
  );
}
