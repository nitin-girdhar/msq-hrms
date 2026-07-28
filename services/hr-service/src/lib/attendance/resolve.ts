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
 * Status for a day that has punches, from worked minutes and the effective
 * thresholds:
 *   - not yet checked out (workedMinutes null)  → 'present' (tentative)
 *   - worked >= min_full_day_minutes            → 'present'
 *   - worked >= min_half_day_minutes            → 'half_day'
 *   - below the half-day floor                  → 'absent'
 *
 * The last branch is deliberate: a day with events CAN be absent. Before this,
 * min_half_day_minutes was never compared against anything and every checked-out
 * day below a full day became 'half_day' — so a 2-minute session counted as half
 * a day's attendance. An 'absent' day resolved this way keeps its first_in /
 * last_out / worked_minutes and resolution_source = 'events' for the audit trail,
 * and stays regularizable so a genuine short day can be corrected.
 */
export function resolveEventStatus(
  workedMinutes: number | null,
  thresholds: ShiftThresholds,
): 'present' | 'half_day' | 'absent' {
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

/**
 * Total worked minutes as the SUM of paired check-in→check-out sessions.
 *
 * Replaces the old (last_out - first_in) wall-clock span, which counted the gap
 * between sessions as work: a split shift of 09:00-13:00 + 17:00-21:00 scored
 * 720 minutes for 480 actually worked. Summing the pairs is correct for split
 * shifts and equally correct for a regular employee who punches out for lunch.
 *
 * Pairing walks the events in chronological order with one open cursor:
 *   - check_in  opens the cursor. If one is ALREADY open, that earlier session
 *     was abandoned — the employee moved to the next segment without punching
 *     out — so it contributes ZERO and the cursor restarts here. Carrying the
 *     earlier cursor forward instead would credit the whole gap between the two
 *     segments, which is the very bug this function exists to fix.
 *   - check_out closes the cursor and adds the elapsed minutes
 *   - a check_out with nothing open is ignored (orphan)
 *   - a cursor still open at the end contributes ZERO
 * Either kind of unclosed session sets hasOpenSession, which surfaces on the day
 * as "Missing check-out" and points the employee at regularization.
 *
 * `events` MUST be sorted by occurred_at ascending; callers order in SQL.
 */
export function summarizeSessions(events: SessionEvent[]): SessionSummary {
  let total = 0;
  let closedAny = false;
  let openAt: number | null = null;
  let abandoned = false;

  for (const e of events) {
    const ts = Date.parse(e.occurred_at);
    if (Number.isNaN(ts)) continue;
    if (e.event_type === 'check_in') {
      if (openAt !== null) abandoned = true;
      openAt = ts;
      continue;
    }
    if (openAt !== null) {
      total += Math.max(0, ts - openAt);
      closedAny = true;
      openAt = null;
    }
  }

  return {
    workedMinutes: closedAny ? Math.round(total / 60_000) : null,
    hasOpenSession: abandoned || openAt !== null,
  };
}
