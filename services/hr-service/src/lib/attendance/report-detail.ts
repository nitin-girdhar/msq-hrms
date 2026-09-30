// ─────────────────────────────────────────────────────────────────────────────
// Detailed month attendance report — shaping only. Pure functions, no I/O.
//
// Input is the raw day grid (every roster employee × every date of the month up
// to today) and every punch of those days, both read by
// attendance.repository.reportDetail. Output is one row per employee-day and one
// row per check-in → check-out session, which report-export.ts renders to
// xlsx / csv.
//
// Sessions are paired with the SAME pairSessions the day classifier uses, over
// the same punches (face review pending/rejected excluded), so the report can
// never show a session the status did not count, or the reverse. Excluded
// punches still appear, on their own row, marked "not counted".
// ─────────────────────────────────────────────────────────────────────────────

import { pairSessions } from './resolve.js';
import { weekdayOf } from './time.js';

export interface ReportDayRow {
  user_id: string;
  user_full_name: string;
  user_email: string;
  weekly_off_pattern: number[] | null;
  date_of_joining: string | null;
  date_of_exit: string | null;
  work_date: string;
  status_name: string | null;
  status_label: string | null;
  first_in_local: string | null;
  last_out_local: string | null;
  worked_minutes: number | null;
  is_late: boolean | null;
  is_early_exit: boolean | null;
  has_open_session: boolean | null;
  has_pending_face_review: boolean | null;
  has_off_window_punch: boolean | null;
  resolution_source: string | null;
  holiday_name: string | null;
  holiday_is_optional: boolean | null;
  leave_type_label: string | null;
  leave_half: string | null;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  reg_status: string | null;
  reg_requested_status: string | null;
  reg_requested_in_local: string | null;
  reg_requested_out_local: string | null;
  reg_reason: string | null;
  reg_approver_name: string | null;
  reg_approver_comment: string | null;
}

export interface ReportEventRow {
  user_id: string;
  work_date: string;
  event_type: 'check_in' | 'check_out';
  occurred_at: string;
  /** HH:MM in the org timezone. */
  local_time: string;
  is_wfh: boolean;
  geo_exception_type: string | null;
  face_review_status: string | null;
  is_off_segment: boolean | null;
}

export interface DetailDay {
  user_id: string;
  user_full_name: string;
  user_email: string;
  work_date: string;
  weekday: string;
  /** Machine key: a status name, or in_progress / not_marked / not_marked_yet (today) / not_employed / unresolved. */
  status_key: string;
  status_label: string;
  remarks: string;
  shift: string;
  first_in: string;
  last_out: string;
  session_count: number;
  sessions: string;
  worked_minutes: number | null;
  is_late: boolean;
  is_early_exit: boolean;
  wfh: boolean;
  regularization: string;
  is_regularized: boolean;
}

export interface DetailSession {
  user_full_name: string;
  user_email: string;
  work_date: string;
  /** 1-based among the day's counted sessions; null for a punch not counted. */
  seq: number | null;
  check_in: string;
  check_out: string;
  minutes: number | null;
  location: string;
  note: string;
  counted: boolean;
}

export interface DetailReport {
  days: DetailDay[];
  sessions: DetailSession[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HALF_LABEL: Record<string, string> = { first_half: 'first half', second_half: 'second half' };

/** "4h 08m". */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '';
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function locationOf(e: ReportEventRow): string {
  if (e.is_wfh) return 'WFH';
  if (e.geo_exception_type === 'remote_role') return 'Remote';
  return 'Office';
}

function countsTowardDay(e: ReportEventRow): boolean {
  return e.face_review_status !== 'pending' && e.face_review_status !== 'rejected';
}

export interface DisplayStatus {
  key: string;
  label: string;
}

/** The fields displayStatus reads — the muster report's rows carry exactly these. */
export type StatusInputRow = Pick<
  ReportDayRow,
  | 'work_date' | 'status_name' | 'status_label' | 'has_open_session'
  | 'date_of_joining' | 'date_of_exit' | 'holiday_name' | 'holiday_is_optional'
  | 'weekly_off_pattern' | 'leave_type_label' | 'leave_half'
>;

/**
 * The status shown for a day. A resolved row speaks for itself, except today's
 * still-open check-in, which is shown as in progress rather than as the
 * tentative 'present' it is stored as. A day with no row yet (the nightly job
 * has not reached it) is derived with the job's own precedence, so the report
 * does not show "not marked" for a known holiday, weekly off or leave.
 */
export function displayStatus(d: StatusInputRow, today: string, hasEvents: boolean): DisplayStatus {
  const isToday = d.work_date === today;
  if (d.status_name) {
    if (isToday && d.has_open_session && d.status_name === 'present') {
      return { key: 'in_progress', label: 'In Progress' };
    }
    return { key: d.status_name, label: d.status_label ?? d.status_name };
  }
  if ((d.date_of_joining && d.work_date < d.date_of_joining) || (d.date_of_exit && d.work_date > d.date_of_exit)) {
    return { key: 'not_employed', label: 'Not Employed' };
  }
  if (d.holiday_name && !d.holiday_is_optional) return { key: 'holiday', label: 'Holiday' };
  if ((d.weekly_off_pattern ?? []).includes(weekdayOf(d.work_date))) return { key: 'weekly_off', label: 'Weekly Off' };
  if (d.leave_type_label) {
    return d.leave_half && d.leave_half !== 'full'
      ? { key: 'half_day', label: 'Half Day' }
      : { key: 'on_leave', label: 'On Leave' };
  }
  if (isToday) return hasEvents ? { key: 'in_progress', label: 'In Progress' } : { key: 'not_marked_yet', label: 'Not Marked Yet' };
  if (hasEvents) return { key: 'unresolved', label: 'Pending Resolution' };
  return { key: 'not_marked', label: 'Not Marked' };
}

function regularizationText(d: ReportDayRow): string {
  if (!d.reg_status) return '';
  const parts: string[] = [capitalize(d.reg_status)];
  if (d.reg_approver_name && d.reg_status !== 'pending') parts[0] += ` by ${d.reg_approver_name}`;
  const asked: string[] = [];
  if (d.reg_requested_status) asked.push(d.reg_requested_status);
  if (d.reg_requested_in_local || d.reg_requested_out_local) {
    asked.push(`${d.reg_requested_in_local ?? '?'}–${d.reg_requested_out_local ?? '?'}`);
  }
  if (asked.length) parts.push(`requested ${asked.join(' ')}`);
  if (d.reg_reason) parts.push(`reason: ${d.reg_reason}`);
  if (d.reg_approver_comment) parts.push(`comment: ${d.reg_approver_comment}`);
  return parts.join('; ');
}

export function buildDetailReport(input: { today: string; days: ReportDayRow[]; events: ReportEventRow[] }): DetailReport {
  const eventsByDay = new Map<string, ReportEventRow[]>();
  for (const e of input.events) {
    const key = `${e.user_id}|${e.work_date}`;
    const list = eventsByDay.get(key);
    if (list) list.push(e);
    else eventsByDay.set(key, [e]);
  }

  const days: DetailDay[] = [];
  const sessions: DetailSession[] = [];

  for (const d of input.days) {
    const events = eventsByDay.get(`${d.user_id}|${d.work_date}`) ?? [];
    const isToday = d.work_date === input.today;
    const status = displayStatus(d, input.today, events.length > 0);
    const isRegularized = d.resolution_source === 'regularization';

    // ── Sessions ──────────────────────────────────────────────────────────────
    const paired = pairSessions(events.filter(countsTowardDay));
    const daySessions: DetailSession[] = [];
    let seq = 0;
    for (const s of paired) {
      seq += 1;
      let note = '';
      if (!s.checkOut && isRegularized) note = 'No check-out — day regularized';
      else if (s.abandoned) note = 'Checked in again without checking out — not counted';
      else if (!s.checkOut) note = isToday ? 'In progress' : 'No check-out — not counted';
      if (s.checkIn.is_off_segment || s.checkOut?.is_off_segment) {
        note = note ? `${note}; outside shift window` : 'Outside shift window';
      }
      daySessions.push({
        user_full_name: d.user_full_name,
        user_email: d.user_email,
        work_date: d.work_date,
        seq,
        check_in: s.checkIn.local_time,
        check_out: s.checkOut ? s.checkOut.local_time : isToday && !s.abandoned ? '' : 'MISSING',
        minutes: s.minutes,
        location: locationOf(s.checkIn),
        note,
        counted: s.checkOut !== null,
      });
    }
    for (const e of events.filter((x) => !countsTowardDay(x))) {
      daySessions.push({
        user_full_name: d.user_full_name,
        user_email: d.user_email,
        work_date: d.work_date,
        seq: null,
        check_in: e.event_type === 'check_in' ? e.local_time : '',
        check_out: e.event_type === 'check_out' ? e.local_time : '',
        minutes: null,
        location: locationOf(e),
        note: e.face_review_status === 'rejected'
          ? 'Rejected in face review — not counted'
          : 'Face review pending — not counted',
        counted: false,
      });
    }
    daySessions.sort((a, b) => (a.check_in || a.check_out).localeCompare(b.check_in || b.check_out));
    sessions.push(...daySessions);

    // ── Remarks ───────────────────────────────────────────────────────────────
    const remarks: string[] = [];
    if (d.holiday_name) remarks.push(`Holiday: ${d.holiday_name}${d.holiday_is_optional ? ' (optional)' : ''}`);
    if (d.leave_type_label) {
      const half = d.leave_half ? HALF_LABEL[d.leave_half] : undefined;
      remarks.push(`Leave: ${d.leave_type_label}${half ? ` (${half})` : ''}`);
    }
    if (status.key === 'missed_punch') remarks.push('Check-out missing — not counted as present until regularized');
    if (status.key === 'in_progress') remarks.push('Checked in, not yet checked out');
    if (isRegularized) remarks.push('Regularized');
    else if (d.reg_status === 'pending') remarks.push('Regularization pending');
    if (d.has_pending_face_review) remarks.push('Face review pending — minutes withheld');
    if (d.has_off_window_punch) remarks.push('Punch outside shift window');

    const counted = paired.filter((s) => s.checkOut);
    days.push({
      user_id: d.user_id,
      user_full_name: d.user_full_name,
      user_email: d.user_email,
      work_date: d.work_date,
      weekday: WEEKDAYS[weekdayOf(d.work_date)]!,
      status_key: status.key,
      status_label: status.label,
      remarks: remarks.join('; '),
      shift: d.shift_name ? `${d.shift_name} (${d.shift_start}–${d.shift_end})` : '',
      first_in: d.first_in_local ?? '',
      last_out: d.last_out_local ?? '',
      session_count: counted.length,
      sessions: paired
        .map((s) => `${s.checkIn.local_time}–${s.checkOut ? `${s.checkOut.local_time} (${formatMinutes(s.minutes)})` : isToday && !s.abandoned ? 'now' : 'MISSING'}`)
        .join('; '),
      worked_minutes: d.worked_minutes,
      is_late: d.is_late ?? false,
      is_early_exit: d.is_early_exit ?? false,
      wfh: events.some((e) => e.is_wfh && countsTowardDay(e)) || d.status_name === 'wfh',
      regularization: regularizationText(d),
      is_regularized: isRegularized,
    });
  }

  return { days, sessions };
}
