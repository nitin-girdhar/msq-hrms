// ─────────────────────────────────────────────────────────────────────────────
// Roster planner rules. Pure - no DB, no clock - so every case is unit-testable.
//
// The planner edits hr.shift_assignments, which is effective-dated and guarded by a
// no-overlap exclusion per person. Setting "shift X for these dates" therefore means
// CARVING the dates out of whatever rows already cover them, then inserting the new
// row. The rows only ever touch end to end, and the order of the returned operations
// (shrinks and deletes before inserts) keeps the exclusion constraint satisfied at
// every step. The same carve is what a shift swap does for one day (swap.ts planSplit).
// ─────────────────────────────────────────────────────────────────────────────

import { restGapProblem, MIN_REST_HOURS, type ShiftTimes } from './swap.js';

const DAY_MS = 86_400_000;

export const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export interface Window {
  id: string;
  shiftId: string;
  from: string;
  /** null = open-ended. */
  to: string | null;
}

export type Op =
  | { kind: 'shrink'; id: string; newTo: string }
  | { kind: 'delete'; id: string }
  | { kind: 'insert'; shiftId: string; from: string; to: string | null };

/** Latest of two ISO dates; null (open end) counts as infinity. */
const endsAfter = (to: string | null, date: string): boolean => to === null || to > date;

/**
 * Operations that make `shiftId` the person's shift for [from, to] (inclusive) and leave
 * everything outside that range exactly as it was. `shiftId = null` clears the range
 * (no shift on those dates). Rows that do not touch the range are left alone.
 */
export function planRange(existing: Window[], from: string, to: string, shiftId: string | null): Op[] {
  if (to < from) throw new Error('planRange: to is before from');
  const trims: Op[] = [];
  const inserts: Op[] = [];

  for (const w of existing) {
    const touches = w.from <= to && (w.to === null || w.to >= from);
    if (!touches) continue;
    const hasLeft = w.from < from;
    const hasRight = endsAfter(w.to, to);
    if (hasLeft) {
      trims.push({ kind: 'shrink', id: w.id, newTo: addDays(from, -1) });
      if (hasRight) inserts.push({ kind: 'insert', shiftId: w.shiftId, from: addDays(to, 1), to: w.to });
    } else {
      trims.push({ kind: 'delete', id: w.id });
      if (hasRight) inserts.push({ kind: 'insert', shiftId: w.shiftId, from: addDays(to, 1), to: w.to });
    }
  }
  if (shiftId !== null) inserts.push({ kind: 'insert', shiftId, from, to });
  // Shrinks/deletes first, then inserts: the exclusion constraint holds at every step.
  return [...trims, ...inserts];
}

/** The shift a person works on `date` once `ops` have been applied to `windows`. */
export function shiftOnAfter(windows: Window[], ops: Op[], date: string): string | null {
  const live = new Map<string, Window>(windows.map((w) => [w.id, { ...w }]));
  let n = 0;
  for (const op of ops) {
    if (op.kind === 'shrink') live.get(op.id)!.to = op.newTo;
    else if (op.kind === 'delete') live.delete(op.id);
    else live.set(`new-${n++}`, { id: `new-${n}`, shiftId: op.shiftId, from: op.from, to: op.to });
  }
  for (const w of live.values()) if (w.from <= date && (w.to === null || w.to >= date)) return w.shiftId;
  return null;
}

/** Dates from `from` to `to` inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Rest problems an edit would create. `shiftOn(date)` is the person's shift on a date AFTER the edit.
 * Every day from the day before `from` to the day after `to` is checked against its neighbours, so a
 * range edit is judged on its boundaries and on every day inside it.
 */
export function restProblems(
  shiftOn: (date: string) => ShiftTimes | null,
  from: string,
  to: string,
  minRestHours = MIN_REST_HOURS,
): Array<{ date: string; reason: string }> {
  const problems: Array<{ date: string; reason: string }> = [];
  for (const date of eachDate(addDays(from, -1), addDays(to, 1))) {
    const mine = shiftOn(date);
    if (!mine) continue;
    const reason = restGapProblem(date, mine, { prev: shiftOn(addDays(date, -1)), next: shiftOn(addDays(date, 1)) }, minRestHours);
    if (reason) problems.push({ date, reason });
  }
  // The same gap is seen from both sides; keep one entry per date.
  return problems.filter((p, i) => problems.findIndex((q) => q.date === p.date) === i);
}

/** Monday of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}
