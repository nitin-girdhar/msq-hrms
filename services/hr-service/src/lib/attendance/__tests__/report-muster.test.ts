import { describe, it, expect } from 'vitest';
import { buildMusterReport, daysInMonth, musterDay, type MusterDayRow } from '../report-muster';

const TODAY = '2026-09-30';

function day(work_date: string, over: Partial<MusterDayRow> = {}): MusterDayRow {
  return {
    user_id: 'u1', user_full_name: 'Isha Yadav', user_email: 'isha@example.com',
    employee_code: 'FC-0001', designation: 'Sales Executive', department: 'Sales',
    org_id: 'o1', org_name: 'Sector 57', org_today: TODAY,
    // 2026-09-06 is a Sunday.
    weekly_off_pattern: [0], date_of_joining: '2026-01-01', date_of_exit: null,
    work_date, status_name: null, status_label: null, has_open_session: null,
    holiday_name: null, holiday_is_optional: null,
    leave_type_label: null, leave_half: null, leave_is_paid: null,
    ...over,
  };
}

describe('musterDay', () => {
  it('maps resolved statuses to codes and weights', () => {
    expect(musterDay(day('2026-09-01', { status_name: 'present' }))).toMatchObject({ code: 'P', present: 1 });
    expect(musterDay(day('2026-09-01', { status_name: 'wfh' }))).toMatchObject({ code: 'P', present: 1 });
    expect(musterDay(day('2026-09-01', { status_name: 'half_day' }))).toMatchObject({ code: 'HD', present: 0.5 });
    expect(musterDay(day('2026-09-01', { status_name: 'absent' }))).toMatchObject({ code: 'A', present: 0 });
    expect(musterDay(day('2026-09-01', { status_name: 'missed_punch' }))).toMatchObject({ code: 'MP', present: 0, weekoff: 0, paidLeave: 0, holiday: 0 });
    expect(musterDay(day('2026-09-06', { status_name: 'weekly_off' }))).toMatchObject({ code: 'WO', weekoff: 1 });
    expect(musterDay(day('2026-09-01', { status_name: 'holiday' }))).toMatchObject({ code: 'H', holiday: 1 });
  });

  it('splits leave by whether its type is paid', () => {
    const paid = day('2026-09-02', { status_name: 'on_leave', leave_type_label: 'Casual', leave_half: 'full', leave_is_paid: true });
    const lop = day('2026-09-02', { status_name: 'on_leave', leave_type_label: 'Loss of pay', leave_half: 'full', leave_is_paid: false });
    expect(musterDay(paid)).toMatchObject({ code: 'L', paidLeave: 1 });
    expect(musterDay(lop)).toMatchObject({ code: 'LOP', paidLeave: 0, present: 0 });
  });

  it('a half-day leave pays the leave half only when the type is paid', () => {
    const paidHalf = day('2026-09-03', { status_name: 'half_day', leave_type_label: 'Casual', leave_half: 'first_half', leave_is_paid: true });
    const lopHalf = day('2026-09-03', { status_name: 'half_day', leave_type_label: 'Loss of pay', leave_half: 'first_half', leave_is_paid: false });
    expect(musterDay(paidHalf)).toMatchObject({ code: 'HD/L', present: 0.5, paidLeave: 0.5 });
    expect(musterDay(lopHalf)).toMatchObject({ code: 'HD', present: 0.5, paidLeave: 0 });
  });

  it('derives unresolved days with the job precedence and blanks days outside employment', () => {
    expect(musterDay(day('2026-09-06')).code).toBe('WO');
    expect(musterDay(day('2026-09-01', { date_of_joining: '2026-09-15' })).code).toBe('');
    // A Sunday before joining is not a paid week-off.
    expect(musterDay(day('2026-09-06', { date_of_joining: '2026-09-15' }))).toMatchObject({ code: '', weekoff: 0 });
    expect(musterDay(day('2026-09-29', { date_of_exit: '2026-09-20' })).code).toBe('');
    // A finished day nothing ever marked reads as absent; today not yet marked stays blank.
    expect(musterDay(day('2026-09-01')).code).toBe('A');
    expect(musterDay(day(TODAY)).code).toBe('');
  });

  it('an optional holiday is not a paid holiday', () => {
    expect(musterDay(day('2026-09-01', { holiday_name: 'Diwali', holiday_is_optional: true })).code).toBe('A');
    expect(musterDay(day('2026-09-01', { holiday_name: 'Diwali', holiday_is_optional: false })).code).toBe('H');
  });
});

describe('daysInMonth', () => {
  it('handles 28, 29, 30 and 31-day months', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-09')).toBe(30);
    expect(daysInMonth('2026-10')).toBe(31);
  });
});

describe('buildMusterReport', () => {
  it('builds one row per employee with one cell per day and the paid-day totals', () => {
    const rows = [
      day('2026-09-01', { status_name: 'present' }),
      day('2026-09-02', { status_name: 'half_day' }),
      day('2026-09-03', { status_name: 'on_leave', leave_type_label: 'Casual', leave_half: 'full', leave_is_paid: true }),
      day('2026-09-04', { status_name: 'absent' }),
      day('2026-09-06', { status_name: 'weekly_off' }),
    ];
    const r = buildMusterReport('2026-09', rows);
    expect(r.days_in_month).toBe(30);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row.days).toHaveLength(30);
    expect(row.days.slice(0, 6)).toEqual(['P', 'HD', 'L', 'A', '', 'WO']);
    expect(row).toMatchObject({
      sl_no: 1, name: 'Isha Yadav', designation: 'Sales Executive', department: 'Sales', branch: 'Sector 57',
      present: 1.5, weekoff_paid: 1, paid_leave: 1, holidays: 0, total_paid: 3.5,
    });
  });

  it('sorts by branch then name and numbers the rows', () => {
    const r = buildMusterReport('2026-09', [
      day('2026-09-01', { user_id: 'u2', user_full_name: 'Vivek', org_id: 'o2', org_name: 'Sector 49', status_name: 'present' }),
      day('2026-09-01', { user_id: 'u3', user_full_name: 'Aman', org_id: 'o1', org_name: 'Sector 57', status_name: 'present' }),
      day('2026-09-01', { user_id: 'u1', user_full_name: 'Isha', org_id: 'o1', org_name: 'Sector 57', status_name: 'present' }),
    ]);
    expect(r.rows.map((x) => [x.sl_no, x.branch, x.name])).toEqual([
      [1, 'Sector 49', 'Vivek'],
      [2, 'Sector 57', 'Aman'],
      [3, 'Sector 57', 'Isha'],
    ]);
  });

  it('keeps an employee who moved branch as one row per branch', () => {
    const r = buildMusterReport('2026-09', [
      day('2026-09-01', { org_id: 'o1', org_name: 'Sector 57', status_name: 'present' }),
      day('2026-09-20', { org_id: 'o2', org_name: 'Sector 49', status_name: 'present' }),
    ]);
    expect(r.rows.map((x) => [x.branch, x.present])).toEqual([['Sector 49', 1], ['Sector 57', 1]]);
  });
});
