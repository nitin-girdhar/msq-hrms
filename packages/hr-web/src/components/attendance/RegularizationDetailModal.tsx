'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { RegularizationDetail } from '../../lib/attendance/types';
import { REGULARIZATION_STATUS_STYLES, formatDay, formatDateTime } from '../../lib/attendance/format';
import ApprovalChainList from '../shared/ApprovalChainList';

interface Props {
  regularizationId: string | null;
  onClose: () => void;
}

export default function RegularizationDetailModal({ regularizationId, onClose }: Props) {
  const [detail, setDetail] = useState<RegularizationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!regularizationId) return;
    setLoading(true);
    attendanceApi.regularizations
      .getById(regularizationId)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load request.'))
      .finally(() => setLoading(false));
  }, [regularizationId]);

  if (!regularizationId) return null;

  const style = detail ? REGULARIZATION_STATUS_STYLES[detail.status] : null;

  return (
    <Modal open onClose={onClose} title="Regularization request" maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        {loading && <div className="py-8 text-center text-sm text-[#94A3B8]">Loading…</div>}

        {detail && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm">
              <Row label="Date" value={formatDay(detail.work_date)} />
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">Status</dt>
                <dd>
                  {style && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}>
                      {detail.status}
                    </span>
                  )}
                </dd>
              </div>
              <Row label="Requested status" value={detail.requested_status_name ?? '—'} />
              <Row label="Requested in" value={formatDateTime(detail.requested_in)} />
              <Row label="Requested out" value={formatDateTime(detail.requested_out)} />
              <Row label="Reason" value={detail.reason} full />
            </dl>

            {detail.pending_with && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Currently pending with <span className="font-semibold">{detail.pending_with.approver_name}</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Approval chain</h3>
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
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">{label}</dt>
      <dd className="text-[#0F172A]">{value}</dd>
    </div>
  );
}
