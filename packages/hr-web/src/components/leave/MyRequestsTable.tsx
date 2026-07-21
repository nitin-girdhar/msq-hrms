import { Button } from '@platform/ui-kit';
import type { LeaveRequestView } from '../../lib/leave/types';
import { formatDateRange, formatDays, formatDateTime, canCancelRequest } from '../../lib/leave/format';
import StatusChip from './StatusChip';

interface Props {
  items: LeaveRequestView[];
  onCancel: (req: LeaveRequestView) => void;
  busyId?: string | null;
}

export default function MyRequestsTable({ items, onCancel, busyId }: Props) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
        No leave requests found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Dates</th>
            <th className="px-4 py-3">Days</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Applied</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
              <td className="px-4 py-3 font-medium text-[#0F172A]">{r.leave_type_label}</td>
              <td className="px-4 py-3 text-[#475569]">
                {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
                {r.reason && <p className="mt-0.5 text-[11px] text-[#94A3B8]">{r.reason}</p>}
              </td>
              <td className="px-4 py-3 text-[#475569]">{formatDays(r.days_count)}</td>
              <td className="px-4 py-3">
                <StatusChip status={r.status_name} label={r.status_label} />
              </td>
              <td className="px-4 py-3 text-[11px] text-[#94A3B8]">{formatDateTime(r.created_at)}</td>
              <td className="px-4 py-3 text-right">
                {canCancelRequest(r.status_name, r.start_date) ? (
                  <Button variant="danger" onClick={() => onCancel(r)} disabled={busyId === r.id}>
                    {busyId === r.id ? 'Cancelling…' : 'Cancel'}
                  </Button>
                ) : (
                  <span className="text-xs text-[#CBD5E1]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
