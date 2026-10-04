import { Button } from '@platform/ui-kit';
import type { LeaveRequestView } from '../../lib/leave/types';
import { formatDateRange, formatDays, formatDateTime, canCancelRequest, canEditRequest } from '../../lib/leave/format';
import { emptyBlockCls } from '../../lib/ui';
import { leave as leaveApi } from '../../lib/api/client';
import StatusChip from './StatusChip';

interface Props {
  items: LeaveRequestView[];
  onView: (req: LeaveRequestView) => void;
  onEdit: (req: LeaveRequestView) => void;
  onCancel: (req: LeaveRequestView) => void;
  busyId?: string | null;
}

export default function MyRequestsTable({ items, onView, onEdit, onCancel, busyId }: Props) {
  if (items.length === 0) return <p className={emptyBlockCls}>No leave requests found.</p>;

  // The approver's open question: shown until the requester edits the request.
  const infoNote = (r: LeaveRequestView) =>
    r.info_requested_at && r.status_name === 'pending' ? (
      <p className="mt-1.5 rounded-lg bg-status-due-container px-2 py-1 text-label-sm text-on-status-due-container">
        Your approver asked: “{r.info_request_note}” — edit the request to answer.
      </p>
    ) : null;

  const actions = (r: LeaveRequestView) => (
    <>
      <Button variant="secondary" onClick={() => onView(r)} disabled={busyId === r.id}>
        View
      </Button>
      {canEditRequest(r.status_name) && (
        <Button variant="secondary" onClick={() => onEdit(r)} disabled={busyId === r.id}>
          Edit
        </Button>
      )}
      {canCancelRequest(r.status_name) && (
        <Button variant="danger" onClick={() => onCancel(r)} disabled={busyId === r.id}>
          {busyId === r.id ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
    </>
  );

  return (
    <>
      {/* Phone: a card per request instead of a 6-column table scrolled sideways. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((r) => (
          <li key={r.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-on-surface">{r.leave_type_label} {r.request_no ? <span className="font-mono text-xs text-primary">LV-{r.request_no}</span> : null}</p>
                <p className="text-xs text-on-surface-variant">
                  {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)} · {formatDays(r.days_count)}
                </p>
              </div>
              <StatusChip status={r.status_name} label={r.status_label} />
            </div>
            {r.reason && <p className="mt-2 text-xs text-on-surface-variant">{r.reason}</p>}
            {infoNote(r)}
            <p className="mt-1 text-label-sm text-outline">Applied {formatDateTime(r.created_at)}</p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">{actions(r)}</div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm md:block">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3">Reviewer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Applied</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{r.request_no ? `LV-${r.request_no}` : '—'}</td>
                <td className="px-4 py-3 font-medium text-on-surface">{r.leave_type_label}</td>
                <td className="px-4 py-3 text-on-surface-variant">
                  {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
                  {r.reason && <p className="mt-0.5 text-label-sm text-outline">{r.reason}</p>}
                  {r.handover_name && <p className="mt-0.5 text-label-sm text-outline">Handover: {r.handover_name}</p>}
                  {r.attachment_name && <a href={leaveApi.attachmentUrl(r.id)} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block text-label-sm font-semibold text-primary hover:underline">📎 {r.attachment_name}</a>}
                  {infoNote(r)}
                </td>
                <td className="px-4 py-3 text-on-surface-variant">{formatDays(r.days_count)}</td>
                <td className="px-4 py-3 text-xs text-on-surface-variant">{r.latest_approver_name ?? '—'}</td>
                <td className="px-4 py-3">
                  <StatusChip status={r.status_name} label={r.status_label} />
                </td>
                <td className="px-4 py-3 text-label-sm text-outline">{formatDateTime(r.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">{actions(r)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
