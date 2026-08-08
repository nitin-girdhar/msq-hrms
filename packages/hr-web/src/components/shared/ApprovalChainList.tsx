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
}

interface Props {
  steps: ApprovalChainStep[];
  formatDateTime: (iso: string | null) => string;
}

const ACTION_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: 'bg-amber-50', fg: 'text-amber-700', label: 'Pending' },
  approved: { bg: 'bg-emerald-50', fg: 'text-emerald-700', label: 'Approved' },
  rejected: { bg: 'bg-red-50', fg: 'text-red-700', label: 'Rejected' },
};

export default function ApprovalChainList({ steps, formatDateTime }: Props) {
  if (steps.length === 0) {
    return <p className="text-sm text-[#94A3B8]">No approval chain recorded for this request.</p>;
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
            className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
                  Level {step.level}
                </span>
                <span className="font-medium text-[#0F172A]">{step.approver_name}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}>
                {isUpcoming ? 'Upcoming' : style.label}
              </span>
            </div>
            {step.acted_at && (
              <p className="mt-1 text-[11px] text-[#94A3B8]">{formatDateTime(step.acted_at)}</p>
            )}
            {step.comment && (
              <p className="mt-1.5 rounded-lg bg-[#F8FAFC] px-2.5 py-1.5 text-[13px] text-[#475569]">
                {step.comment}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
