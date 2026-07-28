'use client';

import { useState } from 'react';
import { PhotoAvatar } from '@platform/ui-kit';
import type { TeamDayRow } from '../../lib/attendance/types';
import { attendance as attendanceApi } from '../../lib/api/client';
import { ATTENDANCE_STATUS_STYLES, formatClockTime, formatWorkedMinutes } from '../../lib/attendance/format';
import TeamPhotoModal from './TeamPhotoModal';

interface Props {
  rows: TeamDayRow[];
  loading: boolean;
  /** Whether the org enforces face matching — hides the Face column otherwise. */
  faceEnabled: boolean;
  /** Admins may change a member's reference photo from the viewer. */
  canManage: boolean;
  /** Re-fetch after an admin changes a photo. */
  onChanged: () => void;
}

// Colour the match score: green ≥85, amber ≥70, red below. A pending review
// (mismatch/undetermined) always reads as a warning regardless of score.
function scoreClass(score: number, pending: boolean): string {
  if (pending) return 'text-amber-700';
  if (score >= 85) return 'text-green-700';
  if (score >= 70) return 'text-amber-700';
  return 'text-red-700';
}

export default function TeamDayView({ rows, loading, faceEnabled, canManage, onChanged }: Props) {
  const [viewing, setViewing] = useState<TeamDayRow | null>(null);

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
        No team members found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">In</th>
            <th className="px-4 py-3">Out</th>
            <th className="px-4 py-3">Worked</th>
            {faceEnabled && <th className="px-4 py-3">Face</th>}
            <th className="px-4 py-3">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const style = ATTENDANCE_STATUS_STYLES[r.status_name] ?? ATTENDANCE_STATUS_STYLES.not_marked;
            // Day-level, NOT r.face_review_status: that field comes from the
            // check-in matching first_in, so it misses a mismatch on a split
            // shift's later punches — exactly where buddy-punching happens.
            const pending = r.has_pending_face_review;
            return (
              <tr key={r.user_id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setViewing(r)}
                      title="View attendance photos"
                      className="rounded-full ring-offset-1 transition hover:ring-2 hover:ring-[#0b6cbf]/40"
                    >
                      <PhotoAvatar
                        src={r.has_photo ? attendanceApi.face.referenceUrl(r.user_id) : null}
                        label={r.user_full_name}
                        sizeClass="h-8 w-8"
                      />
                    </button>
                    <div className="min-w-0">
                      <p className="font-medium text-[#0F172A]">{r.user_full_name}</p>
                      <p className="text-[11px] text-[#94A3B8]">{r.user_email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}>{r.status_label}</span>
                </td>
                <td className="px-4 py-3 text-[#475569]">{formatClockTime(r.first_in)}</td>
                <td className="px-4 py-3 text-[#475569]">{formatClockTime(r.last_out)}</td>
                <td className="px-4 py-3 text-[#475569]">{formatWorkedMinutes(r.worked_minutes)}</td>
                {faceEnabled && (
                  <td className="px-4 py-3">
                    {/* The review marker stands on its own rather than being
                        appended to a score. A not-enrolled punch and a CompreFace
                        outage are both 'pending' with a NULL score, and those are
                        the cases most worth surfacing — previously they rendered
                        as a grey dash and disappeared. */}
                    {r.face_match_score != null || pending ? (
                      <button
                        type="button"
                        onClick={() => setViewing(r)}
                        className={`font-semibold ${scoreClass(r.face_match_score ?? 0, pending)} hover:underline`}
                        title={pending ? 'A punch is awaiting face review — its time is not counted' : 'View photos'}
                      >
                        {r.face_match_score != null ? `${Math.round(r.face_match_score)}%` : 'No score'}
                        {pending ? ' ⚑' : ''}
                      </button>
                    ) : (
                      <span className="text-[11px] text-[#94A3B8]">{r.first_in ? '—' : ''}</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-[11px] text-amber-700">
                  <div className="flex flex-wrap gap-x-2">
                    {r.is_late && <span>Late</span>}
                    {r.is_early_exit && <span>Early exit</span>}
                    {/* Both already came back from the API and were being dropped. */}
                    {r.has_off_window_punch && <span>Outside window</span>}
                    {r.has_open_session && <span>Missing check-out</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <TeamPhotoModal row={viewing} canManage={canManage} onClose={() => setViewing(null)} onChanged={onChanged} />
    </div>
  );
}
