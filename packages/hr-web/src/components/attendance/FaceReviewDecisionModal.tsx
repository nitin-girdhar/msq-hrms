'use client';

// Decide a flagged punch by LOOKING at it: the enrolled reference photo beside
// the selfie actually captured. A similarity score alone is not something a
// manager can act on — 62% could be bad lighting or a different person — but two
// photos side by side settle it in a second.
//
// Both photos load on demand, matching TeamPhotoModal's deliberate privacy
// choice: attendance selfies are never fetched until someone asks to see them.

import { useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { FaceReviewView } from '../../lib/attendance/types';
import { formatDateTime } from '../../lib/attendance/format';

interface Props {
  review: FaceReviewView | null;
  onClose: () => void;
  onDecided: (message: string) => void;
}

function PhotoPane({ src, label, caption }: { src: string | null; label: string; caption: string }) {
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex-1">
      <p className="mb-1 text-xs font-semibold text-[#64748B]">{label}</p>
      {!src || failed ? (
        <p className="rounded-lg border border-dashed border-[#E2E8F0] py-10 text-center text-[11px] text-[#94A3B8]">
          {!src ? 'Not available' : 'Photo unavailable'}
        </p>
      ) : show ? (
        <div className="overflow-hidden rounded-lg bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={label} onError={() => setFailed(true)} className="w-full object-cover" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShow(true)}
          className="w-full rounded-lg border border-dashed border-[#CBD5E1] py-10 text-xs font-medium text-[#0b6cbf] hover:bg-slate-50"
        >
          Load photo
        </button>
      )}
      <p className="mt-1 text-[10px] leading-tight text-[#94A3B8]">{caption}</p>
    </div>
  );
}

export default function FaceReviewDecisionModal({ review, onClose, onDecided }: Props) {
  const [busy, setBusy] = useState<'clear' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!review) return null;

  const who = review.user_full_name ?? review.user_id;
  const punch = review.event_type === 'check_in' ? 'Check-in' : 'Check-out';

  const decide = async (action: 'clear' | 'reject') => {
    setError(null);
    setBusy(action);
    try {
      if (action === 'clear') {
        await attendanceApi.faceReviews.clear(review.event_id);
        onDecided(`Punch confirmed — the time has been added back to ${who}’s day.`);
      } else {
        await attendanceApi.faceReviews.reject(review.event_id);
        onDecided(`Punch rejected — it has been removed from ${who}’s day.`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record the decision.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title="Review face match" locked={busy !== null} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm">
          <p className="font-semibold text-[#0F172A]">{who}</p>
          <p className="text-xs text-[#64748B]">
            {punch} · {formatDateTime(review.occurred_at)}
          </p>
          <p className="mt-1 text-xs">
            {review.face_match_score != null ? (
              <>
                Match score <span className="font-semibold text-amber-700">{Math.round(review.face_match_score)}%</span>
              </>
            ) : (
              // No comparison happened at all — not the same as a low score, and
              // the reviewer should not read it as evidence either way.
              <span className="text-[#64748B]">
                No score — the employee was not enrolled, or face matching was unavailable.
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-3">
          <PhotoPane
            src={attendanceApi.face.referenceUrl(review.user_id)}
            label="Reference"
            caption="The enrolled photo on file."
          />
          <PhotoPane
            src={review.photo_url ? attendanceApi.photoUrl(review.event_id) : null}
            label="This punch"
            caption="The selfie captured at the punch."
          />
        </div>

        {/* State the consequence: these buttons move someone's recorded hours. */}
        <p className="text-xs text-[#64748B]">
          This punch is not counted while it waits. <strong className="font-semibold text-[#0F172A]">Confirm</strong> if
          the faces match — the time is added back to the day. <strong className="font-semibold text-[#0F172A]">Reject</strong>{' '}
          if they do not — the punch is discarded and the day recalculated without it.
        </p>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => decide('reject')}
            disabled={busy !== null}
            className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject punch'}
          </button>
          <button
            type="button"
            onClick={() => decide('clear')}
            disabled={busy !== null}
            className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60"
          >
            {busy === 'clear' ? 'Confirming…' : 'Confirm punch'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
