'use client';

import { useMemo, useState } from 'react';
import { PhotoAvatar } from '@platform/ui-kit';
import type { TeamDayRow } from '../../lib/attendance/types';
import { attendance as attendanceApi } from '../../lib/api/client';
import { ATTENDANCE_STATUS_STYLES, formatClockTime, formatWorkedMinutes } from '../../lib/attendance/format';
import { emptyBlockCls, stateBlockCls } from '../../lib/ui';
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
  /** Roster tools (hr.attendance.admin.override): row selection and "add a punch". Omit for read-only. */
  tools?: {
    selected: Set<string>;
    onToggle: (userId: string) => void;
    onToggleAll: (userIds: string[]) => void;
    onManualPunch: (row: TeamDayRow) => void;
  };
}

type Filter = 'all' | 'late' | 'not_marked' | 'flagged';

// Colour the match score: green ≥85, amber ≥70, red below. A pending review
// (mismatch/undetermined) always reads as a warning regardless of score.
function scoreClass(score: number, pending: boolean): string {
  if (pending) return 'text-on-status-due-container';
  if (score >= 85) return 'text-on-status-success-container';
  if (score >= 70) return 'text-on-status-due-container';
  return 'text-on-status-overdue-container';
}

const isFlagged = (r: TeamDayRow) =>
  r.is_early_exit || r.has_off_window_punch || r.has_open_session || r.has_pending_face_review;
const isOnDuty = (r: TeamDayRow) => r.status_name === 'present' || r.status_name === 'wfh' || r.status_name === 'half_day';

export default function TeamDayView({ rows, loading, faceEnabled, canManage, onChanged, tools }: Props) {
  const [viewing, setViewing] = useState<TeamDayRow | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(
    () => ({
      all: rows.length,
      onDuty: rows.filter(isOnDuty).length,
      late: rows.filter((r) => r.is_late).length,
      onLeave: rows.filter((r) => r.status_name === 'on_leave').length,
      notMarked: rows.filter((r) => r.status_name === 'not_marked').length,
      flagged: rows.filter(isFlagged).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    if (filter === 'late') return rows.filter((r) => r.is_late);
    if (filter === 'not_marked') return rows.filter((r) => r.status_name === 'not_marked');
    if (filter === 'flagged') return rows.filter(isFlagged);
    return rows;
  }, [rows, filter]);

  if (loading) return <div className={stateBlockCls}>Loading…</div>;
  if (rows.length === 0) return <p className={emptyBlockCls}>No team members found.</p>;

  const flags = (r: TeamDayRow) => (
    <div className="flex flex-wrap gap-x-2">
      {r.is_late && <span>Late</span>}
      {r.is_early_exit && <span>Early exit</span>}
      {/* Both already came back from the API and were being dropped. */}
      {r.has_off_window_punch && <span>Outside window</span>}
      {r.has_open_session && <span>Missing check-out</span>}
    </div>
  );

  const person = (r: TeamDayRow) => (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => setViewing(r)}
        title="View attendance photos"
        aria-label={`View attendance photos for ${r.user_full_name}`}
        className="rounded-full ring-offset-1 transition hover:ring-2 hover:ring-primary/40"
      >
        <PhotoAvatar
          src={r.has_photo ? attendanceApi.face.referenceUrl(r.user_id) : null}
          label={r.user_full_name}
          sizeClass="h-8 w-8"
        />
      </button>
      <div className="min-w-0">
        <p className="truncate font-medium text-on-surface">{r.user_full_name}</p>
        <p className="truncate text-label-sm text-outline">{r.user_email}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Team" value={counts.all} />
        <Tile label="On duty" value={counts.onDuty} tone="success" />
        <Tile label="Late" value={counts.late} tone={counts.late > 0 ? 'due' : 'neutral'} />
        <Tile label="On leave" value={counts.onLeave} />
        <Tile label="Not marked" value={counts.notMarked} tone={counts.notMarked > 0 ? 'overdue' : 'neutral'} />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter team attendance">
        {([
          ['all', 'All', counts.all],
          ['late', 'Late', counts.late],
          ['not_marked', 'Not marked', counts.notMarked],
          ['flagged', 'Flagged', counts.flagged],
        ] as const).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              filter === key
                ? 'border-primary bg-primary-fixed text-on-primary-fixed'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            {label} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className={emptyBlockCls}>No one matches this filter.</p>
      ) : (
        <>
          {/* Phone: a card per person — the 7-column table cannot fit 390px. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((r) => {
              const style = ATTENDANCE_STATUS_STYLES[r.status_name] ?? ATTENDANCE_STATUS_STYLES.not_marked;
              return (
                <li key={r.user_id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    {tools && (
                      <input type="checkbox" checked={tools.selected.has(r.user_id)} onChange={() => tools.onToggle(r.user_id)} aria-label={`Select ${r.user_full_name}`} className="mt-2 h-4 w-4 shrink-0 accent-primary" />
                    )}
                    {person(r)}
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-label-sm font-medium ${style.bg} ${style.fg}`}>{r.status_label}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-label-sm text-outline">In</dt><dd className="tabular-nums text-on-surface">{formatClockTime(r.first_in)}</dd></div>
                    <div><dt className="text-label-sm text-outline">Out</dt><dd className="tabular-nums text-on-surface">{formatClockTime(r.last_out)}</dd></div>
                    <div><dt className="text-label-sm text-outline">Worked</dt><dd className="tabular-nums text-on-surface">{formatWorkedMinutes(r.worked_minutes)}</dd></div>
                  </dl>
                  {isFlagged(r) || r.is_late ? <div className="mt-2 text-label-sm text-on-status-due-container">{flags(r)}</div> : null}
                  {tools && <button type="button" onClick={() => tools.onManualPunch(r)} className="mt-2 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed">Add a punch</button>}
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  {tools && (
                    <th className="w-10 px-4 py-3">
                      <input type="checkbox" aria-label="Select everyone shown" checked={visible.length > 0 && visible.every((r) => tools.selected.has(r.user_id))} onChange={() => tools.onToggleAll(visible.map((r) => r.user_id))} className="h-4 w-4 accent-primary" />
                    </th>
                  )}
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
                {visible.map((r) => {
                  const style = ATTENDANCE_STATUS_STYLES[r.status_name] ?? ATTENDANCE_STATUS_STYLES.not_marked;
                  // Day-level, NOT r.face_review_status: that field comes from the
                  // check-in matching first_in, so it misses a mismatch on a split
                  // shift's later punches — exactly where buddy-punching happens.
                  const pending = r.has_pending_face_review;
                  return (
                    <tr key={r.user_id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                      {tools && (
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={tools.selected.has(r.user_id)} onChange={() => tools.onToggle(r.user_id)} aria-label={`Select ${r.user_full_name}`} className="h-4 w-4 accent-primary" />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {person(r)}
                        {tools && <button type="button" onClick={() => tools.onManualPunch(r)} className="mt-1 text-label-sm font-semibold text-primary hover:underline">Add a punch</button>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium ${style.bg} ${style.fg}`}>{r.status_label}</span>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">{formatClockTime(r.first_in)}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{formatClockTime(r.last_out)}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{formatWorkedMinutes(r.worked_minutes)}</td>
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
                            <span className="text-label-sm text-outline">{r.first_in ? '—' : ''}</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-label-sm text-on-status-due-container">{flags(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <TeamPhotoModal row={viewing} canManage={canManage} onClose={() => setViewing(null)} onChanged={onChanged} />
    </div>
  );
}

const ACCENT = {
  neutral: 'bg-outline-variant',
  success: 'bg-status-success',
  due: 'bg-status-due',
  overdue: 'bg-status-overdue',
} as const;

function Tile({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: keyof typeof ACCENT }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${ACCENT[tone]}`} aria-hidden="true" />
      <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="mt-0.5 font-mono text-headline-md font-bold tabular-nums text-on-surface">{value}</p>
    </div>
  );
}
