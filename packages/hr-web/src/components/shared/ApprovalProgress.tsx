// Where a request stands in its approval chain, for list rows and queue cards: how many
// levels have signed off, who it is waiting on, and who has approved. Reads the summary the
// list endpoints attach (hr.vw_leave_approval_summary / vw_regularization_approval_summary).
// Renders nothing for a request with no chain rows (created before levels existed).

export interface ApprovalProgressData {
  approval_levels_total?: number;
  approval_levels_approved?: number;
  pending_level?: number | null;
  pending_approver_name?: string | null;
  approved_by_names?: string[];
}

interface Props {
  data: ApprovalProgressData;
  /** The request's own status; a decided request shows who approved, not who it is "pending with". */
  status: string;
}

export default function ApprovalProgress({ data, status }: Props) {
  const total = data.approval_levels_total ?? 0;
  if (total === 0) return null;
  const approved = data.approval_levels_approved ?? 0;
  const names = data.approved_by_names ?? [];
  const waiting = status === 'pending' && data.pending_approver_name;

  return (
    <div className="flex flex-col gap-0.5 text-label-sm text-on-surface-variant">
      {total > 1 && (
        <span className="font-semibold text-on-surface">
          {status === 'pending' ? `Level ${data.pending_level ?? approved} of ${total}` : `${approved} of ${total} levels approved`}
        </span>
      )}
      {waiting && <span>Pending with <strong className="text-on-surface">{data.pending_approver_name}</strong></span>}
      {names.length > 0 && <span>Approved by {names.join(', ')}</span>}
    </div>
  );
}
