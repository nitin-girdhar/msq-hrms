// Pairing a work date's punches into sessions. Pure — no React, no I/O.
//
// A day row carries only first_in and last_out, which describe ONE session. On a
// split shift that pair spans the whole day including the unpaid gaps, so it
// reads as a single impossibly long stretch and hides every punch in between.
// Both the dashboard's Today card and the day-detail modal show the individual
// slots instead, and must agree on how punches pair up — hence one helper.

import type { DayEventView, ShiftSegmentView } from './types';

export interface Session {
  in: DayEventView | null;
  out: DayEventView | null;
}

/**
 * Pair the day's punches into sessions, in time order.
 *
 * Unmatched punches are kept as half-open sessions rather than dropped: a
 * missing check-out is precisely what the employee is looking for when they open
 * this.
 */
export function toSessions(events: DayEventView[]): Session[] {
  const ordered = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const sessions: Session[] = [];
  for (const event of ordered) {
    const open = sessions[sessions.length - 1];
    if (event.event_type === 'check_in') {
      sessions.push({ in: event, out: null });
    } else if (open && open.out === null) {
      open.out = event;
    } else {
      sessions.push({ in: null, out: event });
    }
  }
  return sessions;
}

/** Minutes inside a session; null while it is still open (or never closed). */
export function sessionMinutes(session: Session): number | null {
  if (!session.in || !session.out) return null;
  return Math.round((Date.parse(session.out.occurred_at) - Date.parse(session.in.occurred_at)) / 60_000);
}

export interface SlotRow {
  /** 1-based position, matching the "slot N of M" wording on the punch button. */
  seq: number;
  /** The declared slot window, when the shift has one at this position. */
  scheduled: ShiftSegmentView | null;
  /** What was actually punched at this position, if anything yet. */
  session: Session | null;
}

/**
 * Line up actual sessions against the shift's declared slots, by position.
 *
 * Position is the only link available: attendance_events records whether a punch
 * fell outside every declared slot (is_off_segment) but not WHICH slot it hit,
 * and the server's own "slot N of M" counter is likewise positional. Extra
 * sessions beyond the declared slots still get a row — an off-schedule punch must
 * stay visible rather than be silently dropped for not fitting the grid.
 */
export function toSlotRows(segments: ShiftSegmentView[], sessions: Session[]): SlotRow[] {
  const ordered = [...segments].sort((a, b) => a.seq - b.seq);
  const rows: SlotRow[] = [];
  for (let i = 0; i < Math.max(ordered.length, sessions.length); i += 1) {
    rows.push({ seq: i + 1, scheduled: ordered[i] ?? null, session: sessions[i] ?? null });
  }
  return rows;
}

/** 'HH:MM:SS' (a shift/segment TIME column) → 'HH:MM'. */
export function formatSlotWindow(segment: ShiftSegmentView): string {
  return `${segment.start_time.slice(0, 5)}–${segment.end_time.slice(0, 5)}`;
}
