// ─────────────────────────────────────────────────────────────────────────────
// Combined attendance (muster) report — shaping only. Pure functions, no I/O.
//
// The payroll sheet HR teams keep by hand: one row per employee, one cell per
// day of the month, then the paid-day totals. Input is the day grid read by
// attendance.repository.reportMuster (every roster employee of every branch in
// reach × every date of the month up to that branch's today); output is what the
// Reports page renders and report-export.ts writes to xlsx.
//
// A day's status comes from displayStatus — the SAME precedence the detailed
// report and the nightly job use — so the three can never disagree about a day.
// This module only maps that status to a cell code and a paid-day weight.
// ─────────────────────────────────────────────────────────────────────────────

import { displayStatus, type StatusInputRow } from './report-detail.js';

export interface MusterDayRow extends StatusInputRow {
  user_id: string;
  user_full_name: string;
  user_email: string;
  employee_code: string | null;
  designation: string | null;
  department: string | null;
  org_id: string;
  org_name: string;
  /** The branch's own "today" (its timezone), so a running day is never judged final. */
  org_today: string;
  /** hr.leave_types.is_paid of the day's leave; null when there is no leave. */
  leave_is_paid: boolean | null;
}

/** Cell codes, in the order the legend shows them. */
export const MUSTER_CODES = {
  P: 'Present',
  HD: 'Half day',
  'HD/L': 'Half day + half paid leave',
  A: 'Absent / missed punch / not marked',
  L: 'Paid leave',
  LOP: 'Loss of pay (unpaid leave)',
  WO: 'Weekly off',
  H: 'Holiday',
} as const;
export type MusterCode = keyof typeof MUSTER_CODES | '';

export interface MusterRow {
  sl_no: number;
  user_id: string;
  employee_code: string | null;
  name: string;
  email: string;
  designation: string | null;
  department: string | null;
  date_of_joining: string | null;
  org_id: string;
  branch: string;
  /** One code per day of the month, index 0 = the 1st. '' = not employed / not reached yet. */
  days: MusterCode[];
  present: number;
  weekoff_paid: number;
  paid_leave: number;
  holidays: number;
  total_paid: number;
}

export interface MusterReport {
  month: string;
  days_in_month: number;
  rows: MusterRow[];
}

interface DayValue {
  code: MusterCode;
  present: number;
  weekoff: number;
  paidLeave: number;
  holiday: number;
}

const BLANK: DayValue = { code: '', present: 0, weekoff: 0, paidLeave: 0, holiday: 0 };
const ABSENT: DayValue = { ...BLANK, code: 'A' };

/**
 * One day's cell and weights.
 *
 *  present / wfh / in_progress   P     1 present
 *  half_day (no leave)           HD    ½ present
 *  half_day + paid half leave    HD/L  ½ present + ½ paid leave
 *  half_day + unpaid half leave  HD    ½ present (the other half is loss of pay)
 *  on_leave, paid type           L     1 paid leave
 *  on_leave, unpaid type         LOP   0
 *  weekly_off                    WO    1 week-off (every week-off inside employment is paid)
 *  holiday (non-optional)        H     1 holiday
 *  absent / missed_punch / a past day never marked   A   0
 *  not_employed / today not marked yet               ''  0
 */
export function musterDay(d: MusterDayRow): DayValue {
  // No events are loaded for this report: a finished day with punches but no
  // resolved row reads as not_marked and so as absent — the nightly job resolves
  // every finished day, so this only shows for a day it has not reached yet.
  const status = displayStatus(d, d.org_today, false);
  const paid = d.leave_is_paid !== false;
  switch (status.key) {
    case 'present':
    case 'wfh':
    case 'in_progress':
      return { ...BLANK, code: 'P', present: 1 };
    case 'half_day': {
      const halfLeave = d.leave_type_label !== null && d.leave_half !== null && d.leave_half !== 'full';
      return halfLeave && paid
        ? { ...BLANK, code: 'HD/L', present: 0.5, paidLeave: 0.5 }
        : { ...BLANK, code: 'HD', present: 0.5 };
    }
    case 'on_leave':
      return paid ? { ...BLANK, code: 'L', paidLeave: 1 } : { ...BLANK, code: 'LOP' };
    case 'weekly_off':
      return { ...BLANK, code: 'WO', weekoff: 1 };
    case 'holiday':
      return { ...BLANK, code: 'H', holiday: 1 };
    case 'absent':
    case 'missed_punch':
    case 'not_marked':
    case 'unresolved':
      return ABSENT;
    default:
      // not_employed, not_marked_yet, and any status a tenant adds later that
      // this sheet has no rule for — left blank rather than guessed at.
      return BLANK;
  }
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function buildMusterReport(month: string, input: MusterDayRow[]): MusterReport {
  const total = daysInMonth(month);
  const byEmployee = new Map<string, MusterRow>();

  for (const d of input) {
    // An employee is one row per BRANCH: someone who moved mid-month appears
    // under each branch they have days in.
    const key = `${d.org_id}|${d.user_id}`;
    let row = byEmployee.get(key);
    if (!row) {
      row = {
        sl_no: 0,
        user_id: d.user_id,
        employee_code: d.employee_code,
        name: d.user_full_name,
        email: d.user_email,
        designation: d.designation,
        department: d.department,
        date_of_joining: d.date_of_joining,
        org_id: d.org_id,
        branch: d.org_name,
        days: new Array<MusterCode>(total).fill(''),
        present: 0,
        weekoff_paid: 0,
        paid_leave: 0,
        holidays: 0,
        total_paid: 0,
      };
      byEmployee.set(key, row);
    }
    const index = Number(d.work_date.slice(8, 10)) - 1;
    if (index < 0 || index >= total) continue;
    const v = musterDay(d);
    row.days[index] = v.code;
    row.present += v.present;
    row.weekoff_paid += v.weekoff;
    row.paid_leave += v.paidLeave;
    row.holidays += v.holiday;
  }

  const rows = [...byEmployee.values()].sort(
    (a, b) => a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id),
  );
  rows.forEach((r, i) => {
    r.sl_no = i + 1;
    r.total_paid = r.present + r.weekoff_paid + r.paid_leave + r.holidays;
  });
  return { month, days_in_month: total, rows };
}
