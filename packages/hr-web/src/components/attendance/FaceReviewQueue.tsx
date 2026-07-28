'use client';

// Punches whose face match failed (or could not complete) and are waiting on a
// human. Their minutes are WITHHELD from the day until someone decides, so this
// queue is not advisory — an unattended row means an employee is not being
// credited, and an ignored one means a possible buddy-punch goes unexamined.
//
// Mirrors RegularizationQueue's shape so the two exception queues on this page
// read as one thing.

import type { FaceReviewView } from '../../lib/attendance/types';
import { formatDateTime } from '../../lib/attendance/format';

interface Props {
  items: FaceReviewView[];
  loading: boolean;
  onReview: (item: FaceReviewView) => void;
}

export default function FaceReviewQueue({ items, loading, onReview }: Props) {
  if (loading) {
    return <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>;
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
        No punches are awaiting face review.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Punch</th>
            <th className="px-4 py-3">When</th>
            <th className="px-4 py-3">Match</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.event_id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
              <td className="px-4 py-3 font-medium text-[#0F172A]">{r.user_full_name ?? r.user_id}</td>
              <td className="px-4 py-3 text-[#475569]">{r.event_type === 'check_in' ? 'Check-in' : 'Check-out'}</td>
              <td className="px-4 py-3 text-[11px] text-[#94A3B8]">{formatDateTime(r.occurred_at)}</td>
              <td className="px-4 py-3">
                {r.face_match_score != null ? (
                  <span className="font-semibold text-amber-700">{Math.round(r.face_match_score)}%</span>
                ) : (
                  // Not enrolled, or the face service was unreachable. Nothing was
                  // compared at all, which is a different problem from a low score.
                  <span className="text-[11px] text-[#94A3B8]">No score</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onReview(r)}
                  className="rounded-lg bg-[#0b6cbf] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#095699]"
                >
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
