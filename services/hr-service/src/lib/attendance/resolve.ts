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
 * Status for a day that has punches, from worked minutes and shift thresholds:
 *   - not yet checked out (workedMinutes null)  → 'present' (tentative)
 *   - worked >= min_full_day_minutes            → 'present'
 *   - otherwise (any presence below a full day) → 'half_day'
 * A day with events is never 'absent'; that status is reserved for days with no
 * punches, no leave, and no holiday/weekly-off.
 */
export function resolveEventStatus(
  workedMinutes: number | null,
  thresholds: ShiftThresholds,
): 'present' | 'half_day' {
  if (workedMinutes === null) return 'present';
  return workedMinutes >= thresholds.minFullDayMinutes ? 'present' : 'half_day';
}

// Default thresholds when a user has no assigned shift (minutes).
export const DEFAULT_THRESHOLDS: ShiftThresholds = {
  minHalfDayMinutes: 240,
  minFullDayMinutes: 480,
};
