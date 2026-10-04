// Month roll-up for the employee's own timesheet header. Pure — no React, no I/O.
// Every figure is derived from the day rows the calendar already loaded, so the
// strip can never disagree with the grid beneath it.

import type { AttendanceDayRow } from './types';

export interface MonthSummary {
  workedMinutes: number;
  /** Days the employee was working: present, WFH, or a half day. */
  presentDays: number;
  lateDays: number;
  /** Days that need the employee to act: absent, a missed punch, or an unclosed check-in. */
  attentionDays: number;
}

export function summariseMonth(days: AttendanceDayRow[]): MonthSummary {
  let workedMinutes = 0;
  let presentDays = 0;
  let lateDays = 0;
  let attentionDays = 0;
  for (const d of days) {
    workedMinutes += d.worked_minutes ?? 0;
    if (d.status_name === 'present' || d.status_name === 'wfh' || d.status_name === 'half_day') presentDays += 1;
    if (d.is_late) lateDays += 1;
    if (d.status_name === 'absent' || d.status_name === 'missed_punch' || d.has_open_session) attentionDays += 1;
  }
  return { workedMinutes, presentDays, lateDays, attentionDays };
}

export interface MonthTargets {
  /** Working days in the whole month (not a weekly off, not a holiday). */
  workingDays: number;
  /** Working days from the 1st up to and including today (the whole month once it is over, none before it starts). */
  elapsedWorkingDays: number;
  /** elapsedWorkingDays x the full-day minutes: what a person should have worked by now. */
  targetMinutes: number;
}

/**
 * How many days, and so how many minutes, a month asks of a person. Pure and date-only (no time zones):
 * `weeklyOff` is 0 = Sunday .. 6 = Saturday, `holidays` are YYYY-MM-DD, `today` is the viewer's YYYY-MM-DD.
 */
export function monthTargets(args: {
  year: number;
  month: number; // 1-12
  weeklyOff: readonly number[];
  holidays: readonly string[];
  today: string;
  fullDayMinutes: number;
}): MonthTargets {
  const { year, month, weeklyOff, holidays, today, fullDayMinutes } = args;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const off = new Set(weeklyOff);
  const hol = new Set(holidays);
  let workingDays = 0;
  let elapsedWorkingDays = 0;
  for (let day = 1; day <= last; day += 1) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (off.has(new Date(`${iso}T00:00:00Z`).getUTCDay()) || hol.has(iso)) continue;
    workingDays += 1;
    if (iso <= today) elapsedWorkingDays += 1;
  }
  return { workingDays, elapsedWorkingDays, targetMinutes: elapsedWorkingDays * fullDayMinutes };
}
