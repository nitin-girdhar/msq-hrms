// ─────────────────────────────────────────────────────────────────────────────
// The window a regularization may reach back into.
//
// Lives here rather than in the zod schema because the bound is per-org
// configuration (hr.attendance_rules.regularization_max_backdate_days) counted
// in the ORG's timezone — neither of which a static schema can know. Pure
// function, no I/O, so the boundary cases are unit-testable without a database.
// ─────────────────────────────────────────────────────────────────────────────

import { orgToday, addDays } from './time.js';

export interface RegularizationWindowRules {
  /** IANA zone the org's attendance work_date is keyed on. */
  timezone: string;
  /** How many days before today may be filed. 0 = today only. */
  regularization_max_backdate_days: number;
}

export interface RegularizationWindow {
  /** Oldest acceptable work_date, YYYY-MM-DD. */
  earliest: string;
  /** Newest acceptable work_date (today in the org zone), YYYY-MM-DD. */
  latest: string;
}

/** The inclusive [earliest, latest] work_date range, as of `now`. */
export function regularizationWindow(
  rules: RegularizationWindowRules,
  now: Date = new Date(),
): RegularizationWindow {
  const latest = orgToday(rules.timezone, now);
  return { earliest: addDays(latest, -rules.regularization_max_backdate_days), latest };
}

/**
 * Why `workDate` is not acceptable, or null when it is. Returning the reason
 * rather than throwing keeps this free of the service's error types, so the same
 * function can answer "is this allowed" and "what do I tell the user".
 *
 * Dates are compared as YYYY-MM-DD strings: for that format lexicographic order
 * IS calendar order, which is what the rest of the attendance code relies on.
 */
export function regularizationWindowError(
  workDate: string,
  rules: RegularizationWindowRules,
  now: Date = new Date(),
): string | null {
  const { earliest, latest } = regularizationWindow(rules, now);
  // Correcting a day that has not happened yet is meaningless, and it would
  // resolve an approver chain as of a date no reporting line covers. Fixed rule,
  // deliberately not configurable.
  if (workDate > latest) {
    return 'A regularization cannot be filed for a future date.';
  }
  if (workDate < earliest) {
    const days = rules.regularization_max_backdate_days;
    return days === 0
      ? `Regularizations are only accepted for today (${latest}).`
      : `Regularizations are only accepted for the last ${days} day(s) — on or after ${earliest}.`;
  }
  return null;
}
