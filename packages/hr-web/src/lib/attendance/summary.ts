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
