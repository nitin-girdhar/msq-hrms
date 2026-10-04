// ─────────────────────────────────────────────────────────────────────────────
// Comp-off (compensatory off) rules. Pure — no DB, no clock — so every case is
// unit-testable. The repository supplies the day's facts (weekly-off pattern,
// holidays, balance) and applies the verdicts.
//
// Model: work on a day off earns a day (or half) back, credited to the tenant's
// `comp_off` leave type when an approver agrees, and lapsing COMP_OFF_EXPIRY_DAYS
// after approval if unused. Spending it is an ordinary leave request against that
// type, so nothing about requests, approvals or balances differs.
// ─────────────────────────────────────────────────────────────────────────────

/** Days an approved credit stays usable. One fixed rule until a per-tenant setting exists. */
export const COMP_OFF_EXPIRY_DAYS = 90;

/** How far back a claim may name the day worked. Older work is an HR adjustment, not a claim. */
export const COMP_OFF_MAX_BACKDATE_DAYS = 60;

/** The leave type comp-off credits live on (seeded for every tenant by the leave_types catalog). */
export const COMP_OFF_LEAVE_TYPE = 'comp_off';

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (UTC calendar arithmetic, no DST drift). */
export function addDaysIso(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Day of week of a calendar date, 0 = Sunday (the same numbering as weekly_off_pattern). */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export type ClaimDateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * May `workedDate` be claimed? It must be a day the employee was not rostered to
 * work (their weekly off, or a mandatory holiday), not in the future, and not
 * older than the backdate window. Whether they actually worked it is the
 * approver's call — the rule here only keeps claims for ordinary working days
 * out of the queue.
 */
export function checkClaimDate(input: {
  workedDate: string;
  today: string;
  weeklyOff: readonly number[];
  holidays: readonly string[];
}): ClaimDateVerdict {
  const { workedDate, today, weeklyOff, holidays } = input;
  if (workedDate > today) return { ok: false, reason: 'You can only claim comp-off for a day you have already worked' };
  if (daysBetweenIso(workedDate, today) > COMP_OFF_MAX_BACKDATE_DAYS) {
    return { ok: false, reason: `Comp-off must be claimed within ${COMP_OFF_MAX_BACKDATE_DAYS} days of the day worked` };
  }
  const isDayOff = weeklyOff.includes(weekdayOf(workedDate)) || holidays.includes(workedDate);
  if (!isDayOff) return { ok: false, reason: 'Comp-off can only be claimed for work on a weekly off or a holiday' };
  return { ok: true };
}

/**
 * How much of an expired credit to lapse. The balance is shared by every credit
 * and by leave already taken, so lapsing the full claim could drive it negative
 * for a day that was in fact spent. Cap at what is left; never below zero.
 */
export function lapseAmount(claimDays: number, balance: number): number {
  return Math.max(0, Math.min(claimDays, balance));
}
