// ─────────────────────────────────────────────────────────────────────────────
// Shared attendance resolution helpers used by both the live punch upsert
// (attendance.repository) and the nightly resolution job (jobs/resolve-attendance).
// Pure functions — no I/O.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShiftThresholds {
  minHalfDayMinutes: number;
  minFullDayMinutes: number;
}

/**
 * Status for a day that has punches, from worked minutes, whether a check-in was
 * left unclosed, whether the work day is over, and the effective thresholds:
 *   - unclosed check-in, day over                → 'missed_punch'
 *   - unclosed check-in, day still running       → 'present' (tentative)
 *   - not yet checked out (workedMinutes null)   → 'present' (tentative)
 *   - worked >= min_full_day_minutes             → 'present'
 *   - worked >= min_half_day_minutes             → 'half_day'
 *   - below the half-day floor                   → 'absent'
 *
 * 'missed_punch' (product decision 2026-09-28): ANY unclosed check-in on a
 * finished day — trailing, or abandoned mid-day by a second check-in — makes the
 * whole day missed, whatever the closed sessions add up to. It is neither present
 * nor paid until regularized. Before this the day stayed 'present' forever: the
 * live punch wrote it tentatively and the nightly job skips rows that exist. The
 * closed sessions' minutes are still stored for the audit trail and the report.
 *
 * The 'absent' branch is deliberate: a day with events CAN be absent. Before it,
 * min_half_day_minutes was never compared against anything and every checked-out
 * day below a full day became 'half_day' — so a 2-minute session counted as half
 * a day's attendance. An 'absent' day resolved this way keeps its first_in /
 * last_out / worked_minutes and resolution_source = 'events' for the audit trail,
 * and stays regularizable so a genuine short day can be corrected.
 */
export function resolveEventStatus(
  workedMinutes: number | null,
  thresholds: ShiftThresholds,
  open: { hasOpenSession: boolean; dayFinished: boolean } = { hasOpenSession: false, dayFinished: false },
): 'present' | 'half_day' | 'absent' | 'missed_punch' {
  if (open.hasOpenSession) return open.dayFinished ? 'missed_punch' : 'present';
  if (workedMinutes === null) return 'present';
  if (workedMinutes >= thresholds.minFullDayMinutes) return 'present';
  if (workedMinutes >= thresholds.minHalfDayMinutes) return 'half_day';
  return 'absent';
}

// Last-resort thresholds: no assigned shift AND no org attendance_rules row.
export const DEFAULT_THRESHOLDS: ShiftThresholds = {
  minHalfDayMinutes: 240,
  minFullDayMinutes: 480,
};

/**
 * Effective thresholds for one employee-day. Precedence, most specific first:
 *   assigned shift → org attendance_rules → DEFAULT_THRESHOLDS.
 */
export function thresholdsFrom(
  shift: { min_half_day_minutes: number; min_full_day_minutes: number } | null | undefined,
  org: ShiftThresholds | null | undefined,
): ShiftThresholds {
  if (shift) {
    return {
      minHalfDayMinutes: shift.min_half_day_minutes,
      minFullDayMinutes: shift.min_full_day_minutes,
    };
  }
  return org ?? DEFAULT_THRESHOLDS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session accounting
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionEvent {
  occurred_at: string;
  event_type: 'check_in' | 'check_out';
}

export interface SessionSummary {
  /** Sum of every CLOSED session, in minutes. null when none ever closed. */
  workedMinutes: number | null;
  /** A check-in was never closed by a check-out. */
  hasOpenSession: boolean;
}

/** One check-in and what closed it, as pairSessions reads the punch list. */
export interface PairedSession<E extends SessionEvent = SessionEvent> {
  checkIn: E;
  /** null = never closed (trailing open, or abandoned by the next check-in). */
  checkOut: E | null;
  /** Closed sessions only; rounded whole minutes. */
  minutes: number | null;
  /** A later check-in arrived while this one was still open. */
  abandoned: boolean;
}

/**
 * Pair a day's punches into check-in → check-out sessions.
 *
 * Walks the events in chronological order with one open cursor:
 *   - check_in  opens the cursor. If one is ALREADY open, that earlier session
 *     was abandoned — the employee moved to the next segment without punching
 *     out — so it contributes ZERO and the cursor restarts here. Carrying the
 *     earlier cursor forward instead would credit the whole gap between the two
 *     segments.
 *   - check_out closes the cursor and records the elapsed minutes
 *   - a check_out with nothing open is ignored (orphan)
 *   - a cursor still open at the end is returned with checkOut null
 *
 * The single source of pairing for both day classification (summarizeSessions)
 * and the detailed report's per-session rows, so the two can never disagree.
 * `events` MUST be sorted by occurred_at ascending; callers order in SQL.
 */
export function pairSessions<E extends SessionEvent>(events: E[]): Array<PairedSession<E>> {
  const out: Array<PairedSession<E>> = [];
  let open: E | null = null;
  let openAt = 0;

  for (const e of events) {
    const ts = Date.parse(e.occurred_at);
    if (Number.isNaN(ts)) continue;
    if (e.event_type === 'check_in') {
      if (open) out.push({ checkIn: open, checkOut: null, minutes: null, abandoned: true });
      open = e;
      openAt = ts;
      continue;
    }
    if (open) {
      out.push({ checkIn: open, checkOut: e, minutes: Math.round(Math.max(0, ts - openAt) / 60_000), abandoned: false });
      open = null;
    }
  }
  if (open) out.push({ checkIn: open, checkOut: null, minutes: null, abandoned: false });
  return out;
}

/**
 * Total worked minutes as the SUM of paired check-in→check-out sessions.
 *
 * Replaces the old (last_out - first_in) wall-clock span, which counted the gap
 * between sessions as work: a split shift of 09:00-13:00 + 17:00-21:00 scored
 * 720 minutes for 480 actually worked. Summing the pairs is correct for split
 * shifts and equally correct for a regular employee who punches out for lunch.
 * Pairing rules: see pairSessions. Either kind of unclosed session sets
 * hasOpenSession, which makes a finished day 'missed_punch' and points the
 * employee at regularization.
 *
 * Minutes are summed in milliseconds and rounded once, not per session, so the
 * day total never drifts from the true span by per-session rounding.
 */
export function summarizeSessions(events: SessionEvent[]): SessionSummary {
  const sessions = pairSessions(events);
  let totalMs = 0;
  let closedAny = false;
  for (const s of sessions) {
    if (!s.checkOut) continue;
    totalMs += Math.max(0, Date.parse(s.checkOut.occurred_at) - Date.parse(s.checkIn.occurred_at));
    closedAny = true;
  }
  return {
    workedMinutes: closedAny ? Math.round(totalMs / 60_000) : null,
    hasOpenSession: sessions.some((s) => s.checkOut === null),
  };
}
