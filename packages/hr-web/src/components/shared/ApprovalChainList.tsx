// Renders a request's full multi-level approval chain — used by both the leave
// and regularization detail modals, which resolve identically-shaped steps
// ({ level, approver_id, approver_name, action, acted_at, comment }) from
// hr.leave_request_approvals / hr.attendance_regularization_approvals.

export interface ApprovalChainStep {
  level: number;
  approver_id: string;
  approver_name: string;
  action: string;
  acted_at: string | null;
  comment: string | null;
  acted_by_id?: string | null;
  acted_by_name?: string | null;
  reassigned_from_name?: string | null;
}

interface Props {
  steps: ApprovalChainStep[];
  formatDateTime: (iso: string | null) => string;
}

const ACTION_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: 'bg-status-due-container', fg: 'text-on-status-due-container', label: 'Pending' },
  approved: { bg: 'bg-status-success-container', fg: 'text-on-status-success-container', label: 'Approved' },
  rejected: { bg: 'bg-status-overdue-container', fg: 'text-on-status-overdue-container', label: 'Rejected' },
};

export default function ApprovalChainList({ steps, formatDateTime }: Props) {
  if (steps.length === 0) {
    return <p className="text-sm text-outline">No approval chain recorded for this request.</p>;
  }

  // The first step still pending is the one currently holding the request —
  // every level after it hasn't been reached yet, so it's labeled "upcoming"
  // rather than just left blank, so the requester can see who approves next
  // after the current approver, not only who it's with right now.
  const firstPendingLevel = steps.find((s) => s.action === 'pending')?.level ?? null;

  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step) => {
        const style = ACTION_STYLES[step.action] ?? ACTION_STYLES.pending!;
        const isUpcoming = firstPendingLevel !== null && step.level > firstPendingLevel;
        return (
          <li
            key={step.level}
            className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-outline">
                  Level {step.level}
                </span>
                <span className="font-medium text-on-surface">{step.approver_name}</span>
                {step.reassigned_from_name && (
                  <span className="text-[0.6875rem] text-outline">(took over from {step.reassigned_from_name})</span>
                )}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${style.bg} ${style.fg}`}>
                {isUpcoming ? 'Upcoming' : style.label}
              </span>
            </div>
            {step.acted_at && (
              <p className="mt-1 text-[0.6875rem] text-outline">
                {step.action === 'rejected' ? 'Rejected' : 'Approved'}
                {step.acted_by_name && step.acted_by_id !== step.approver_id ? ` by ${step.acted_by_name} (on behalf of ${step.approver_name})` : ''}
                {' · '}{formatDateTime(step.acted_at)}
              </p>
            )}
            {step.comment && (
              <p className="mt-1.5 rounded-lg bg-surface-container-low px-2.5 py-1.5 text-[0.8125rem] text-on-surface-variant">
                {step.comment}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
