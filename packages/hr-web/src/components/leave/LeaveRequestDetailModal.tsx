'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveRequestDetail } from '../../lib/leave/types';
import { formatDateRange, formatDays, formatDateTime } from '../../lib/leave/format';
import ApprovalChainList from '../shared/ApprovalChainList';
import StatusChip from './StatusChip';

interface Props {
  requestId: string | null;
  onClose: () => void;
}

export default function LeaveRequestDetailModal({ requestId, onClose }: Props) {
  const [detail, setDetail] = useState<LeaveRequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!requestId) return;
    setLoading(true);
    leaveApi
      .getById(requestId)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load request.'))
      .finally(() => setLoading(false));
  }, [requestId]);

  if (!requestId) return null;

  return (
    <Modal open onClose={onClose} title="Leave request" maxWidth="max-w-lg" closeOnBackdropClick>
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
        )}
        {loading && <div className="py-8 text-center text-sm text-outline">Loading…</div>}

        {detail && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm">
              <Row label="Type" value={detail.leave_type_label} />
              <div>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-outline">Status</dt>
                <dd><StatusChip status={detail.status_name} label={detail.status_label} /></dd>
              </div>
              <Row label="Dates" value={formatDateRange(detail.start_date, detail.end_date, detail.start_half, detail.end_half)} />
              <Row label="Days" value={formatDays(detail.days_count)} />
              {detail.reason && <Row label="Reason" value={detail.reason} full />}
            </dl>

            {detail.pending_with && (
              <div className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-sm text-on-status-due-container">
                Currently pending with <span className="font-semibold">{detail.pending_with.approver_name}</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-outline">Approval chain</h3>
              <ApprovalChainList steps={detail.approval_chain} formatDateTime={formatDateTime} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-outline">{label}</dt>
      <dd className="text-on-surface">{value}</dd>
    </div>
  );
}
