import { describe, it, expect } from 'vitest';
import { buildDetailReport, formatMinutes, type ReportDayRow, type ReportEventRow } from '../report-detail';
import { detailCsv } from '../report-export';

const TODAY = '2026-09-10';

function day(work_date: string, over: Partial<ReportDayRow> = {}): ReportDayRow {
  return {
    user_id: 'u1', user_full_name: 'Rachna', user_email: 'r@example.com', weekly_off_pattern: [0],
    date_of_joining: '2026-01-01', date_of_exit: null,
    work_date, status_name: null, status_label: null, first_in_local: null, last_out_local: null,
    worked_minutes: null, is_late: null, is_early_exit: null, has_open_session: null,
    has_pending_face_review: null, has_off_window_punch: null, resolution_source: null,
    holiday_name: null, holiday_is_optional: null, leave_type_label: null, leave_half: null,
    shift_name: null, shift_start: null, shift_end: null, reg_status: null, reg_requested_status: null,
    reg_requested_in_local: null, reg_requested_out_local: null, reg_reason: null,
    reg_approver_name: null, reg_approver_comment: null,
    ...over,
  };
}

function ev(work_date: string, hhmm: string, event_type: 'check_in' | 'check_out', over: Partial<ReportEventRow> = {}): ReportEventRow {
  return {
    user_id: 'u1', work_date, event_type, occurred_at: `${work_date}T${hhmm}:00+05:30`, local_time: hhmm,
    is_wfh: false, geo_exception_type: null, face_review_status: null, is_off_segment: null, ...over,
  };
}

describe('buildDetailReport', () => {
  it('emits one session row per check-in/check-out pair', () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [day('2026-09-01', { status_name: 'present', status_label: 'Present', worked_minutes: 480 })],
      events: [
        ev('2026-09-01', '09:00', 'check_in'), ev('2026-09-01', '13:00', 'check_out'),
        ev('2026-09-01', '14:00', 'check_in'), ev('2026-09-01', '18:00', 'check_out'),
      ],
    });
    expect(r.sessions.map((s) => [s.seq, s.check_in, s.check_out, s.minutes])).toEqual([
      [1, '09:00', '13:00', 240],
      [2, '14:00', '18:00', 240],
    ]);
    expect(r.days[0]!.session_count).toBe(2);
    expect(r.days[0]!.sessions).toBe('09:00–13:00 (4h 00m); 14:00–18:00 (4h 00m)');
  });

  it('shows a missed check-out as MISSING and explains it in the remarks', () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [day('2026-09-02', { status_name: 'missed_punch', status_label: 'Missed Punch', has_open_session: true })],
      events: [ev('2026-09-02', '09:05', 'check_in')],
    });
    expect(r.days[0]!.status_key).toBe('missed_punch');
    expect(r.days[0]!.remarks).toMatch(/Check-out missing/);
    expect(r.sessions[0]).toMatchObject({ check_in: '09:05', check_out: 'MISSING', counted: false });
  });

  it("shows today's open check-in as in progress, not present", () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [day(TODAY, { status_name: 'present', status_label: 'Present', has_open_session: true })],
      events: [ev(TODAY, '09:00', 'check_in')],
    });
    expect(r.days[0]!.status_key).toBe('in_progress');
    expect(r.sessions[0]!.check_out).toBe('');
  });

  it('derives weekly off, holiday and leave for days the job has not resolved', () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [
        day('2026-09-06'), // Sunday
        day('2026-09-07', { holiday_name: 'Ganesh Chaturthi', holiday_is_optional: false }),
        day('2026-09-08', { leave_type_label: 'Casual Leave', leave_half: 'first_half' }),
        day('2026-09-09'),
      ],
      events: [],
    });
    expect(r.days.map((d) => d.status_key)).toEqual(['weekly_off', 'holiday', 'half_day', 'not_marked']);
    expect(r.days[1]!.remarks).toBe('Holiday: Ganesh Chaturthi');
    expect(r.days[2]!.remarks).toBe('Leave: Casual Leave (first half)');
  });

  it('marks a regularized day and describes the request', () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [day('2026-09-03', {
        status_name: 'present', status_label: 'Present', resolution_source: 'regularization',
        reg_status: 'approved', reg_approver_name: 'HR Admin', reg_requested_status: 'Present',
        reg_requested_in_local: '09:00', reg_requested_out_local: '18:00', reg_reason: 'Forgot to punch out',
      })],
      events: [ev('2026-09-03', '09:00', 'check_in')],
    });
    expect(r.days[0]!.is_regularized).toBe(true);
    expect(r.days[0]!.remarks).toContain('Regularized');
    expect(r.days[0]!.regularization).toBe('Approved by HR Admin; requested Present 09:00–18:00; reason: Forgot to punch out');
    // The raw punch is still listed, but not as an unexplained missing check-out.
    expect(r.sessions[0]!.note).toBe('No check-out — day regularized');
  });

  it('lists a rejected punch as not counted and leaves it out of the pairing', () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [day('2026-09-04', { status_name: 'present', status_label: 'Present', worked_minutes: 540 })],
      events: [
        ev('2026-09-04', '09:00', 'check_in'),
        ev('2026-09-04', '12:00', 'check_in', { face_review_status: 'rejected' }),
        ev('2026-09-04', '18:00', 'check_out'),
      ],
    });
    const counted = r.sessions.filter((s) => s.seq !== null);
    expect(counted).toHaveLength(1);
    expect(counted[0]!.minutes).toBe(540);
    expect(r.sessions.find((s) => s.seq === null)?.note).toMatch(/Rejected/);
  });
});

describe('buildDetailReport — employment window', () => {
  it('marks days before joining and after exit as not employed, not not-marked', () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [
        day('2026-09-01', { date_of_joining: '2026-09-02' }),
        day('2026-09-02', { date_of_joining: '2026-09-02' }),
        day('2026-09-09', { date_of_exit: '2026-09-08' }),
      ],
      events: [],
    });
    expect(r.days.map((d) => d.status_key)).toEqual(['not_employed', 'not_marked', 'not_employed']);
  });
});

describe('detailCsv', () => {
  it('writes one row per employee-day with a BOM and quoted fields', () => {
    const r = buildDetailReport({
      today: TODAY,
      days: [day('2026-09-01', { status_name: 'present', status_label: 'Present', reg_reason: 'x' })],
      events: [ev('2026-09-01', '09:00', 'check_in'), ev('2026-09-01', '18:00', 'check_out')],
    });
    const csv = detailCsv(r);
    expect(csv.startsWith('﻿Employee,Email,Date')).toBe(true);
    expect(csv.split('\n')).toHaveLength(2);
  });
});

describe('formatMinutes', () => {
  it('pads minutes', () => {
    expect(formatMinutes(125)).toBe('2h 05m');
    expect(formatMinutes(null)).toBe('');
  });
});
