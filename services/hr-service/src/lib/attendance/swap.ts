// ─────────────────────────────────────────────────────────────────────────────
// Shift-swap rules. Pure — no DB, no clock — so every case is unit-testable. The
// repository gathers each person's facts for the day and applies the verdict.
//
// A swap trades two people's shifts for ONE future day. It is allowed only when
// it leaves both people with a legal day: both are rostered to work (not on a
// weekly off, holiday or approved leave), the shifts actually differ, and the
// minimum rest gap holds on both sides of the swapped day for BOTH people.
//
// Times are the shift's envelope (hr.shifts.start_time .. end_time); a shift whose
// end is not after its start, or that is flagged a night shift, runs past midnight.
// Only differences between instants matter, so everything is measured in UTC
// milliseconds against a naive calendar date — no time zone is involved.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback minimum rest between the end of one shift and the start of the next, used only when no
 * policy row applies. The real value is hr.attendance_rules.min_rest_hours (tenant default, org
 * override), which a shift can override with its own hr.shifts.min_rest_hours. 0 turns the rule off.
 */
export const MIN_REST_HOURS = 11;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface ShiftTimes {
  id: string;
  /** 'HH:MM' or 'HH:MM:SS'. */
  start: string;
  end: string;
  isNight: boolean;
  /** This shift's own minimum rest BEFORE it starts; null/undefined = follow the policy. 0 = no rule. */
  minRestHours?: number | null;
}

export interface DayContext {
  /** The shift this person works on the swap date; null when they have none. */
  shift: ShiftTimes | null;
  isWeeklyOff: boolean;
  isHoliday: boolean;
  onLeave: boolean;
  /** Their shift the day before / the day after the swap date (null = none). */
  prev: ShiftTimes | null;
  next: ShiftTimes | null;
}

export type SwapVerdict = { ok: true } | { ok: false; reason: string };

function minutesOf(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** [start, end) of a shift worked on the calendar date `isoDate`, in UTC ms. */
export function shiftSpan(isoDate: string, shift: ShiftTimes): { start: number; end: number } {
  const dayStart = Date.parse(`${isoDate}T00:00:00Z`);
  const start = dayStart + minutesOf(shift.start) * 60_000;
  let end = dayStart + minutesOf(shift.end) * 60_000;
  if (shift.isNight || minutesOf(shift.end) <= minutesOf(shift.start)) end += DAY_MS;
  return { start, end };
}

function shiftDate(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Would `incoming` (the other person's shift) leave this person with enough rest on
 * both sides of `swapDate`? Returns the reason when not.
 */
export function restGapProblem(
  swapDate: string,
  incoming: ShiftTimes,
  ctx: Pick<DayContext, 'prev' | 'next'>,
  minRestHours = MIN_REST_HOURS,
): string | null {
  const span = shiftSpan(swapDate, incoming);
  // The gap is owed to the shift that STARTS after it, so that shift's own setting wins over the policy.
  if (ctx.prev) {
    const hours = incoming.minRestHours ?? minRestHours;
    const prev = shiftSpan(shiftDate(swapDate, -1), ctx.prev);
    if (hours > 0 && span.start - prev.end < hours * HOUR_MS) return `fewer than ${hours} hours of rest after the previous day's shift`;
  }
  if (ctx.next) {
    const hours = ctx.next.minRestHours ?? minRestHours;
    const next = shiftSpan(shiftDate(swapDate, 1), ctx.next);
    if (hours > 0 && next.start - span.end < hours * HOUR_MS) return `fewer than ${hours} hours of rest before the next day's shift`;
  }
  return null;
}

export function checkSwap(input: {
  today: string;
  swapDate: string;
  requester: DayContext;
  peer: DayContext;
  minRestHours?: number;
}): SwapVerdict {
  const { today, swapDate, requester, peer } = input;
  const min = input.minRestHours ?? MIN_REST_HOURS;

  // Future only: a past or current day may already be resolved into attendance.
  if (swapDate <= today) return { ok: false, reason: 'A shift swap must be for a future day' };

  for (const [who, ctx] of [['You', requester], ['They', peer]] as const) {
    if (ctx.isWeeklyOff) return { ok: false, reason: `${who} ${who === 'You' ? 'are' : 'are'} on a weekly off that day` };
    if (ctx.isHoliday) return { ok: false, reason: `That day is a holiday for ${who === 'You' ? 'you' : 'them'}` };
    if (ctx.onLeave) return { ok: false, reason: `${who} ${who === 'You' ? 'are' : 'are'} on approved leave that day` };
    if (!ctx.shift) return { ok: false, reason: `${who} ${who === 'You' ? 'have' : 'have'} no shift assigned that day` };
  }
  // Both shifts are non-null past the loop; narrow for the compiler.
  const mine = requester.shift!;
  const theirs = peer.shift!;
  if (mine.id === theirs.id) return { ok: false, reason: 'You are both on the same shift that day' };

  // After the swap the requester works the peer's shift, and vice versa.
  const requesterProblem = restGapProblem(swapDate, theirs, requester, min);
  if (requesterProblem) return { ok: false, reason: `You would have ${requesterProblem}` };
  const peerProblem = restGapProblem(swapDate, mine, peer, min);
  if (peerProblem) return { ok: false, reason: `They would have ${peerProblem}` };

  return { ok: true };
}

// ── Assignment splitting ─────────────────────────────────────────────────────

export interface AssignmentWindow {
  id: string;
  shiftId: string;
  from: string;
  /** null = open-ended. */
  to: string | null;
}

export interface SplitPlan {
  /** What to do to the existing assignment so it no longer covers `date`. */
  existing: { action: 'shrink'; newTo: string } | { action: 'delete' };
  /** The one-day assignment carrying the swapped-in shift. */
  swapDay: { shiftId: string; from: string; to: string };
  /** The assignment that resumes the original shift the day after, if the original ran past `date`. */
  continuation: { shiftId: string; from: string; to: string | null } | null;
}

/**
 * How to carve ONE DAY out of an assignment so another shift can sit there.
 *
 * The rows only ever touch end to end, so the table's no-overlap exclusion
 * constraint holds at every step as long as the existing row is shrunk (or
 * removed) BEFORE the new rows are inserted. `date` must lie inside `a`.
 */
export function planSplit(a: AssignmentWindow, date: string, incomingShiftId: string): SplitPlan {
  if (date < a.from || (a.to !== null && date > a.to)) {
    throw new Error(`planSplit: ${date} is outside the assignment ${a.from}..${a.to ?? 'open'}`);
  }
  const existing: SplitPlan['existing'] =
    a.from < date ? { action: 'shrink', newTo: shiftDate(date, -1) } : { action: 'delete' };
  const runsPast = a.to === null || a.to > date;
  return {
    existing,
    swapDay: { shiftId: incomingShiftId, from: date, to: date },
    continuation: runsPast ? { shiftId: a.shiftId, from: shiftDate(date, 1), to: a.to } : null,
  };
}
