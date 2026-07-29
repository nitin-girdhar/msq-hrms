'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { AttendanceDayRow, DayEventView } from '../../lib/attendance/types';
import { formatClockTime, formatWorkedMinutes, formatDay } from '../../lib/attendance/format';
import { sessionMinutes, toSessions } from '../../lib/attendance/sessions';

interface Props {
  date: string | null;
  row: AttendanceDayRow | undefined;
  /** Whose day this is — the punch list is fetched per user + work date. */
  userId: string;
  onClose: () => void;
  onRequestRegularization: (date: string) => void;
}

const REGULARIZABLE = new Set(['absent', 'not_marked', 'half_day']);

export default function DayDetailPopover({ date, row, userId, onClose, onRequestRegularization }: Props) {
  // null = still loading (or unavailable, which renders the same as no punches).
  const [events, setEvents] = useState<DayEventView[] | null>(null);

  useEffect(() => {
    if (!date) {
      setEvents(null);
      return;
    }
    let active = true;
    setEvents(null);
    attendanceApi
      .dayEvents({ user_id: userId, date })
      // A failure here (a role without hr.attendance.photo.view) must not break
      // the modal — the day summary above stands on its own.
      .then((res) => { if (active) setEvents(res.data); })
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [date, userId]);

  if (!date) return null;

  const canRegularize = !row || REGULARIZABLE.has(row.status_name);
  const sessions = events ? toSessions(events) : [];

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC]">
        Close
      </button>
      {canRegularize && (
        <button
          type="button"
          onClick={() => onRequestRegularization(date)}
          className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699]"
        >
          Request regularization
        </button>
      )}
    </div>
  );

  return (
    <Modal open onClose={onClose} title={formatDay(date)} maxWidth="max-w-sm" footer={footer}>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm">
          <Row label="Status" value={row?.status_label ?? 'Not marked'} />
          <Row label="Worked" value={formatWorkedMinutes(row?.worked_minutes ?? null)} />
          {/* first_in/last_out bracket the whole day, so once the punches are
              known the per-session list below says it properly and these two are
              only a fallback for when the events could not be loaded. */}
          {sessions.length === 0 && (
            <>
              <Row label="First in" value={formatClockTime(row?.first_in ?? null)} />
              <Row label="Last out" value={formatClockTime(row?.last_out ?? null)} />
            </>
          )}
          {row?.is_late && <Row label="Late" value="Yes" />}
          {row?.is_early_exit && <Row label="Early exit" value="Yes" />}
          {row?.has_open_session && <Row label="Missing check-out" value="Yes" />}
          {row?.has_off_window_punch && <Row label="Outside shift window" value="Yes" />}
          {row?.has_pending_face_review && <Row label="Face review" value="Pending" />}
        </dl>

        {/* Every in/out pair of the day, with the time spent inside each. On a
            split shift this is the only place the middle punches appear at all. */}
        {sessions.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              Sessions ({sessions.length})
            </p>
            <ol className="flex flex-col gap-1">
              {sessions.map((session, i) => {
                const minutes = sessionMinutes(session);
                return (
                  <li
                    key={session.in?.event_id ?? session.out?.event_id ?? i}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm"
                  >
                    <span className="flex items-center gap-1.5 tabular-nums text-[#0F172A]">
                      <span className="text-[11px] font-semibold text-[#94A3B8]">{i + 1}</span>
                      {formatClockTime(session.in?.occurred_at ?? null)}
                      <span className="text-[#CBD5E1]">→</span>
                      {formatClockTime(session.out?.occurred_at ?? null)}
                    </span>
                    <span className="text-xs text-[#64748B]">
                      {minutes == null ? 'Open' : formatWorkedMinutes(minutes)}
                    </span>
                  </li>
                );
              })}
            </ol>
            {/* The sum of the sessions can exceed counted time — a punch held for
                face review, or one outside the shift window, is not paid. */}
            {(row?.has_pending_face_review || row?.has_off_window_punch) && (
              <p className="mt-1.5 text-[11px] text-[#94A3B8]">
                Not every session above counts towards worked time.
              </p>
            )}
          </div>
        )}

        {/* Withheld time looks like a payroll error unless the reason is stated.
            The remedy is review, not regularization, so don't send them there. */}
        {row?.has_pending_face_review && (
          <p className="text-xs text-[#64748B]">
            A photo check on one of your punches needs confirming, so that punch is not
            counted yet. Your manager will review it — the time is added back once it is
            confirmed.
          </p>
        )}

        {/* Worked time is the sum of the day's sessions, so an unclosed one reads
            as lost time. Say why rather than leaving a bare flag above. */}
        {row?.has_open_session && (
          <p className="text-xs text-[#64748B]">
            A check-in was never closed with a check-out, so that session counted as no
            time worked. Request regularization to have it corrected.
          </p>
        )}

      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">{label}</dt>
      <dd className="text-[#0F172A]">{value}</dd>
    </div>
  );
}
