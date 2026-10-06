// The approver's view of a request's chain, shown inside the Review dialogs: a banner saying
// who it is waiting for (and whether that is the viewer), then every level with who approved
// it. When the viewer may not decide it, the server's reason is shown and the dialog disables
// Approve; the approve call re-checks the same rule, so this is a courtesy, not the control.

import ApprovalChainList, { type ApprovalChainStep } from './ApprovalChainList';

export interface ApprovalReviewData {
  approval_chain: ApprovalChainStep[];
  pending_with: { level: number; approver_name: string } | null;
  my_decision: { can_decide: boolean; covering: boolean; reason: string | null };
}

interface Props {
  review: ApprovalReviewData | null;
  loading: boolean;
  error: string | null;
  formatDateTime: (iso: string | null) => string;
}

export default function ApprovalReviewPanel({ review, loading, error, formatDateTime }: Props) {
  if (loading) return <p className="text-sm text-outline">Loading approval chain…</p>;
  if (error) return <p className="text-sm text-outline">Approval chain unavailable: {error}</p>;
  if (!review) return null;

  const total = review.approval_chain.length;
  const { my_decision: me, pending_with: pw } = review;

  return (
    <div className="flex flex-col gap-2">
      {me.can_decide && pw && (
        <div className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-sm text-on-status-due-container">
          {me.covering
            ? <>You are approving level {pw.level}{total > 1 ? ` of ${total}` : ''} on behalf of <span className="font-semibold">{pw.approver_name}</span>. This counts as your approval; your own level will go to the next approver.</>
            : <>Level {pw.level}{total > 1 ? ` of ${total}` : ''} is waiting for your decision.</>}
        </div>
      )}
      {!me.can_decide && me.reason && (
        <div role="status" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-sm text-on-status-overdue-container">
          {me.reason}
          {pw && <> Pending with <span className="font-semibold">{pw.approver_name}</span>.</>}
        </div>
      )}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-outline">Approval chain</h3>
      <ApprovalChainList steps={review.approval_chain} formatDateTime={formatDateTime} />
    </div>
  );
}
