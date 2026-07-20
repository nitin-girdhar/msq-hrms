// ─────────────────────────────────────────────────────────────────────────────
// Shared per-day attendance resolution.
//
// Extracted from the nightly job so the SAME precedence logic is callable from:
//   - jobs/resolve-attendance.ts  (fill every unresolved day up to yesterday)
//   - attendance.repository.ts    (recompute a single day after a face-review
//                                  rejection invalidates an event)
//
// Precedence (Platform_Expansion_Plan §4.3):
//   1. org holiday    → 'holiday'
//   2. weekly off     → 'weekly_off'
//   3. approved leave → 'on_leave' (half-day leave w/o punches → 'half_day')
//   4. events exist   → 'present'/'half_day' per shift thresholds
//   5. else           → 'absent'
//
// Events whose face_review_status = 'rejected' are EXCLUDED from the aggregation —
// a rejected punch is invalid for attendance and must not contribute first_in/
// last_out/worked minutes. A regularization row is never overwritten by callers.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import type { DrizzleTx } from '@platform/db';
import { weekdayOf, parseTimeToMinutes, isLateArrival, isEarlyExit } from './time.js';
import { resolveEventStatus, DEFAULT_THRESHOLDS } from './resolve.js';

export interface DayEmployee {
  user_id: string;
  org_id: string;
  tenant_id: string;
  timezone: string;
  weekly_off_pattern: number[];
}

export interface Resolution {
  status: string;
  source: string;
  leaveRequestId: string | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number | null;
  isLate: boolean;
  isEarlyExit: boolean;
}

interface ShiftRow {
  start_time: string;
  end_time: string;
  grace_minutes: number;
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  is_night_shift: boolean;
}

async function loadShift(tx: DrizzleTx, orgId: string, userId: string, date: string): Promise<ShiftRow | null> {
  const rows = (await tx.execute(sql`
    SELECT s.start_time::text, s.end_time::text, s.grace_minutes,
           s.min_half_day_minutes, s.min_full_day_minutes, s.is_night_shift
    FROM hr.shift_assignments sa
    JOIN hr.shifts s ON s.id = sa.shift_id AND NOT s.is_deleted AND s.is_active
    WHERE sa.user_id = ${userId} AND sa.org_id = ${orgId} AND NOT sa.is_deleted
      AND sa.effective_from <= ${date}::date
      AND (sa.effective_to IS NULL OR sa.effective_to >= ${date}::date)
    ORDER BY sa.effective_from DESC LIMIT 1
  `)) as unknown as ShiftRow[];
  return rows[0] ?? null;
}

/** True when a (user, work_date) row already exists in hr.attendance_days. */
export async function dayRowExists(tx: DrizzleTx, userId: string, date: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM hr.attendance_days WHERE user_id = ${userId} AND work_date = ${date}::date LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length > 0;
}

/**
 * Resolve the status for one (employee, date) via the full precedence. Never
 * returns null — callers decide whether to apply it (see dayRowExists). Event
 * aggregation excludes rejected punches.
 */
export async function computeDayResolution(tx: DrizzleTx, emp: DayEmployee, date: string): Promise<Resolution> {
  // 1. Holiday (non-optional).
  const holiday = (await tx.execute(sql`
    SELECT 1 FROM hr.holidays
    WHERE org_id = ${emp.org_id} AND is_active AND NOT is_deleted AND NOT is_optional AND holiday_date = ${date}::date
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  if (holiday.length > 0) {
    return { status: 'holiday', source: 'holiday', leaveRequestId: null, firstIn: null, lastOut: null, workedMinutes: null, isLate: false, isEarlyExit: false };
  }

  // 2. Weekly off.
  if (emp.weekly_off_pattern?.includes(weekdayOf(date))) {
    return { status: 'weekly_off', source: 'weekly_off', leaveRequestId: null, firstIn: null, lastOut: null, workedMinutes: null, isLate: false, isEarlyExit: false };
  }

  // 3. Approved leave covering the date.
  const leave = (await tx.execute(sql`
    SELECT lr.id::text AS id, lr.start_half, lr.end_half
    FROM hr.leave_requests lr
    JOIN hr.leave_request_statuses s ON s.id = lr.status_id
    WHERE lr.user_id = ${emp.user_id} AND lr.org_id = ${emp.org_id} AND NOT lr.is_deleted
      AND s.name = 'approved'
      AND ${date}::date BETWEEN lr.start_date AND lr.end_date
    LIMIT 1
  `)) as unknown as Array<{ id: string; start_half: string; end_half: string }>;
  if (leave[0]) {
    const isHalf = leave[0].start_half !== 'full' || leave[0].end_half !== 'full';
    const status = isHalf ? 'half_day' : 'on_leave';
    return { status, source: 'leave', leaveRequestId: leave[0].id, firstIn: null, lastOut: null, workedMinutes: null, isLate: false, isEarlyExit: false };
  }

  // 4. Events exist for the date (night-shift aware; excludes rejected punches).
  const shift = await loadShift(tx, emp.org_id, emp.user_id, date);
  const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
  const isNight = shift?.is_night_shift ?? false;
  const local = sql`(e.occurred_at AT TIME ZONE ${emp.timezone})`;
  const wd = isNight
    ? sql`CASE WHEN (EXTRACT(HOUR FROM ${local}) * 60 + EXTRACT(MINUTE FROM ${local})) < ${shiftStartMin}
               THEN ((${local})::date - INTERVAL '1 day')::date ELSE (${local})::date END`
    : sql`(${local})::date`;

  const agg = (await tx.execute(sql`
    SELECT
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'check_in')  AS first_in,
      MAX(e.occurred_at) FILTER (WHERE e.event_type = 'check_out') AS last_out,
      (EXTRACT(HOUR FROM (MIN(e.occurred_at) FILTER (WHERE e.event_type='check_in')  AT TIME ZONE ${emp.timezone})) * 60
       + EXTRACT(MINUTE FROM (MIN(e.occurred_at) FILTER (WHERE e.event_type='check_in')  AT TIME ZONE ${emp.timezone})))::int AS first_in_min,
      (EXTRACT(HOUR FROM (MAX(e.occurred_at) FILTER (WHERE e.event_type='check_out') AT TIME ZONE ${emp.timezone})) * 60
       + EXTRACT(MINUTE FROM (MAX(e.occurred_at) FILTER (WHERE e.event_type='check_out') AT TIME ZONE ${emp.timezone})))::int AS last_out_min
    FROM hr.attendance_events e
    WHERE e.user_id = ${emp.user_id} AND e.org_id = ${emp.org_id}
      AND e.face_review_status IS DISTINCT FROM 'rejected'
      AND ${wd} = ${date}::date
  `)) as unknown as Array<{ first_in: string | null; last_out: string | null; first_in_min: number | null; last_out_min: number | null }>;
  const a = agg[0]!;

  if (a.first_in || a.last_out) {
    let worked: number | null = null;
    if (a.first_in && a.last_out) worked = Math.max(0, Math.round((Date.parse(a.last_out) - Date.parse(a.first_in)) / 60_000));
    const thresholds = shift
      ? { minHalfDayMinutes: shift.min_half_day_minutes, minFullDayMinutes: shift.min_full_day_minutes }
      : DEFAULT_THRESHOLDS;
    const status = resolveEventStatus(worked, thresholds);
    const isLate = shift && a.first_in_min != null ? isLateArrival(a.first_in_min, parseTimeToMinutes(shift.start_time), shift.grace_minutes) : false;
    const isEarly = shift && a.last_out_min != null ? isEarlyExit(a.last_out_min, parseTimeToMinutes(shift.end_time), isNight) : false;
    return { status, source: 'events', leaveRequestId: null, firstIn: a.first_in, lastOut: a.last_out, workedMinutes: worked, isLate, isEarlyExit: isEarly };
  }

  // 5. Absent.
  return { status: 'absent', source: 'job', leaveRequestId: null, firstIn: null, lastOut: null, workedMinutes: null, isLate: false, isEarlyExit: false };
}

/**
 * Persist a resolution into hr.attendance_days.
 *   - overwrite=false (nightly job): insert only if the row is absent.
 *   - overwrite=true  (post-reject recompute): replace the row UNLESS its
 *     resolution_source is 'regularization' (an approved manual override wins).
 */
export async function upsertResolvedDay(
  tx: DrizzleTx,
  emp: DayEmployee,
  date: string,
  r: Resolution,
  opts: { overwrite: boolean },
): Promise<void> {
  const onConflict = opts.overwrite
    ? sql`ON CONFLICT (user_id, work_date) DO UPDATE SET
        first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out, worked_minutes = EXCLUDED.worked_minutes,
        status_id = EXCLUDED.status_id, is_late = EXCLUDED.is_late, is_early_exit = EXCLUDED.is_early_exit,
        leave_request_id = EXCLUDED.leave_request_id, resolved_at = CLOCK_TIMESTAMP(),
        resolution_source = EXCLUDED.resolution_source, updated_at = CLOCK_TIMESTAMP()
        WHERE hr.attendance_days.resolution_source IS DISTINCT FROM 'regularization'`
    : sql`ON CONFLICT (user_id, work_date) DO NOTHING`;

  await tx.execute(sql`
    INSERT INTO hr.attendance_days
      (user_id, org_id, work_date, first_in, last_out, worked_minutes, status_id,
       is_late, is_early_exit, leave_request_id, resolved_at, resolution_source)
    VALUES
      (${emp.user_id}, ${emp.org_id}, ${date}::date, ${r.firstIn}, ${r.lastOut}, ${r.workedMinutes},
       (SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${emp.tenant_id} AND name = ${r.status}),
       ${r.isLate}, ${r.isEarlyExit}, ${r.leaveRequestId}, CLOCK_TIMESTAMP(), ${r.source})
    ${onConflict}
  `);
}
