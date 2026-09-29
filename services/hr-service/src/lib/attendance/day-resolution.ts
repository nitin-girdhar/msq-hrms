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
//   4. events exist   → 'present'/'half_day'/'absent' per the effective thresholds;
//                       'missed_punch' when a check-in was left unclosed and the
//                       work day is over (isDayFinished)
//   5. else           → 'absent'
//
// A day with events CAN now resolve to 'absent' — when the summed session time
// falls below the half-day floor. Such a row still carries its first_in/last_out/
// worked_minutes and resolution_source = 'events', which distinguishes it from a
// true no-show (source 'job', no times) and keeps it regularizable.
//
// worked_minutes is the SUM of paired check-in→check-out sessions, not the
// last_out - first_in span, so the gap between a split shift's segments is not
// counted as worked time.
//
// Events whose face_review_status = 'rejected' are EXCLUDED from the aggregation —
// a rejected punch is invalid for attendance and must not contribute first_in/
// last_out/worked minutes. A regularization row is never overwritten by callers.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import type { DrizzleTx } from '@platform/db';
import { weekdayOf, parseTimeToMinutes, isLateArrival, isEarlyExit, isDayFinished } from './time.js';
import {
  resolveEventStatus,
  summarizeSessions,
  thresholdsFrom,
  type ShiftThresholds,
  type SessionEvent,
} from './resolve.js';

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
  hasOffWindowPunch: boolean;
  hasOpenSession: boolean;
  hasPendingFaceReview: boolean;
}

// Non-event resolutions (holiday, weekly off, leave, absent) share this shape:
// no times, no flags. Spread it so adding a field can't silently miss a branch.
const NO_EVENTS = {
  leaveRequestId: null,
  firstIn: null,
  lastOut: null,
  workedMinutes: null,
  isLate: false,
  isEarlyExit: false,
  hasOffWindowPunch: false,
  hasOpenSession: false,
  hasPendingFaceReview: false,
} as const;

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

interface LeaveCover {
  id: string;
  start_date: string;
  end_date: string;
  start_half: string;
  end_half: string;
}

/**
 * Is `date` a HALF day of this leave? Only the leave's own first day can be a
 * start half and only its last day an end half. Before this, a leave that merely
 * STARTED or ENDED on a half marked every day it covered as half_day — a Mon-Wed
 * leave ending Wednesday first-half paid Monday and Tuesday as half days.
 */
export function isHalfLeaveDay(leave: Omit<LeaveCover, 'id'>, date: string): boolean {
  return (date === leave.start_date && leave.start_half !== 'full')
    || (date === leave.end_date && leave.end_half !== 'full');
}

/**
 * Resolve the status for one (employee, date) via the full precedence. Never
 * returns null — callers decide whether to apply it (see dayRowExists). Event
 * aggregation excludes rejected punches.
 */
export async function computeDayResolution(
  tx: DrizzleTx,
  emp: DayEmployee,
  date: string,
  orgThresholds?: ShiftThresholds,
): Promise<Resolution> {
  // 1. Holiday (non-optional).
  const holiday = (await tx.execute(sql`
    SELECT 1 FROM hr.holidays
    WHERE org_id = ${emp.org_id} AND is_active AND NOT is_deleted AND NOT is_optional AND holiday_date = ${date}::date
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  if (holiday.length > 0) {
    return { status: 'holiday', source: 'holiday', ...NO_EVENTS };
  }

  // 2. Weekly off.
  if (emp.weekly_off_pattern?.includes(weekdayOf(date))) {
    return { status: 'weekly_off', source: 'weekly_off', ...NO_EVENTS };
  }

  // 3. Approved leave covering the date.
  const leave = (await tx.execute(sql`
    SELECT lr.id::text AS id, lr.start_date::text AS start_date, lr.end_date::text AS end_date,
           lr.start_half, lr.end_half
    FROM hr.leave_requests lr
    JOIN hr.leave_request_statuses s ON s.id = lr.status_id
    WHERE lr.user_id = ${emp.user_id} AND lr.org_id = ${emp.org_id} AND NOT lr.is_deleted
      AND s.name = 'approved'
      AND ${date}::date BETWEEN lr.start_date AND lr.end_date
    LIMIT 1
  `)) as unknown as LeaveCover[];
  if (leave[0]) {
    const isHalf = isHalfLeaveDay(leave[0], date);
    const status = isHalf ? 'half_day' : 'on_leave';
    return { status, source: 'leave', ...NO_EVENTS, leaveRequestId: leave[0].id };
  }

  // 4. Events exist for the date.
  const fromEvents = await resolveFromEvents(tx, emp, date, orgThresholds);
  if (fromEvents) return fromEvents;

  // 5. Absent.
  return { status: 'absent', source: 'job', ...NO_EVENTS };
}

/**
 * Step 4 of the precedence on its own: the day as its punches alone resolve it,
 * or null when it has none. Night-shift aware; excludes rejected punches.
 *
 * The nightly job's finalize pass calls this directly for a day the live punch
 * already wrote from events: a punch on a holiday or weekly off must be
 * finalized from its punches, not re-resolved to 'weekly_off' — which would
 * both erase the worked times and leave an unclosed check-in counted.
 */
export async function resolveFromEvents(
  tx: DrizzleTx,
  emp: DayEmployee,
  date: string,
  orgThresholds?: ShiftThresholds,
): Promise<Resolution | null> {
  const shift = await loadShift(tx, emp.org_id, emp.user_id, date);
  const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
  const isNight = shift?.is_night_shift ?? false;
  const local = sql`(e.occurred_at AT TIME ZONE ${emp.timezone})`;
  const wd = isNight
    ? sql`CASE WHEN (EXTRACT(HOUR FROM ${local}) * 60 + EXTRACT(MINUTE FROM ${local})) < ${shiftStartMin}
               THEN ((${local})::date - INTERVAL '1 day')::date ELSE (${local})::date END`
    : sql`(${local})::date`;

  // The full ordered punch list, not MIN/MAX aggregates: worked minutes are the
  // sum of paired sessions, which needs every event in sequence. 'pending' rows
  // are SELECTED but not counted — deriveFromEvents needs to see them to flag the
  // day, so the filter stays at 'rejected' rather than excluding both here.
  const rows = (await tx.execute(sql`
    SELECT e.occurred_at::text AS occurred_at,
           e.event_type,
           e.is_off_segment,
           e.face_review_status,
           (EXTRACT(HOUR   FROM (e.occurred_at AT TIME ZONE ${emp.timezone})) * 60
          + EXTRACT(MINUTE FROM (e.occurred_at AT TIME ZONE ${emp.timezone})))::int AS local_min
    FROM hr.attendance_events e
    WHERE e.user_id = ${emp.user_id} AND e.org_id = ${emp.org_id}
      AND e.face_review_status IS DISTINCT FROM 'rejected'
      AND ${wd} = ${date}::date
    ORDER BY e.occurred_at
  `)) as unknown as DayEventRow[];

  if (rows.length > 0) {
    const dayFinished = isDayFinished(date, emp.timezone, isNight && shift ? parseTimeToMinutes(shift.end_time) : null);
    const d = deriveFromEvents(rows, shift, isNight, thresholdsFrom(shift, orgThresholds), dayFinished);
    return { ...d, source: 'events', leaveRequestId: null };
  }
  return null;
}

export interface DayEventRow extends SessionEvent {
  is_off_segment: boolean | null;
  /** NULL when face matching passed or was not required. */
  face_review_status: string | null;
  local_min: number | null;
}

/**
 * Does this punch count toward the day?
 *
 * Stated as what is EXCLUDED rather than what is allowed, so a null/undefined
 * status — face matching passed, or the org does not require it — counts by
 * default. An allow-list keyed on `=== null` would silently drop every punch for
 * any caller whose row shape omits the field.
 *
 * 'pending'  — awaiting review → WITHHELD. A suspected buddy-punch must not be
 *              paid while it waits; clearing it recomputes the day and restores
 *              the minutes. This also withholds not-enrolled punches and those
 *              taken during a face-service outage, both of which resolve to
 *              'pending' with a null score.
 * 'rejected' — invalid. Already excluded by the SQL filter; repeated here so the
 *              rule holds for any caller that passes unfiltered rows.
 */
function countsTowardDay(row: DayEventRow): boolean {
  return row.face_review_status !== 'pending' && row.face_review_status !== 'rejected';
}

interface DayShift {
  start_time: string;
  end_time: string;
  grace_minutes: number;
}

/**
 * Derive every attendance_days field from a day's ordered punch list. Shared by
 * computeDayResolution (job + face-review recompute) and the live-punch upsert in
 * attendance.repository, so all three write paths agree by construction.
 *
 * is_late / is_early_exit still judge against the shift's OUTER window — for a
 * split shift that is the first segment's start and the last segment's end, which
 * is the intended meaning of arriving late or leaving early for the day.
 *
 * Punches awaiting face review are excluded from EVERY derived value, not just
 * the minutes: an unverified punch must not set first_in, and must not make the
 * day look late or early either. A day whose only punches are pending therefore
 * resolves exactly like a day with no punches — absent, no times — with
 * hasPendingFaceReview set to explain why. hasOffWindowPunch is the deliberate
 * exception: it is a review signal, so it considers every punch.
 *
 * `dayFinished` decides what an unclosed check-in means: still working (the live
 * punch path, always false) or 'missed_punch' (the job / recompute, once
 * isDayFinished says the work day is over).
 */
export function deriveFromEvents(
  rows: DayEventRow[],
  shift: DayShift | null,
  isNight: boolean,
  thresholds: ShiftThresholds,
  dayFinished: boolean,
): Omit<Resolution, 'source' | 'leaveRequestId'> {
  const counted = rows.filter(countsTowardDay);
  const hasPendingFaceReview = rows.some((r) => r.face_review_status === 'pending');
  const hasOffWindowPunch = rows.some((r) => r.is_off_segment === true);

  // Nothing usable left once the withheld punches are removed. This must NOT
  // fall through to resolveEventStatus: null worked-minutes there means "checked
  // in, still working" and yields a tentative 'present', which would credit a day
  // whose every punch is unverified — the opposite of withholding them.
  if (counted.length === 0) {
    return { ...NO_EVENTS, status: 'absent', hasPendingFaceReview, hasOffWindowPunch };
  }

  const firstInRow = counted.find((r) => r.event_type === 'check_in') ?? null;
  const lastOutRow = [...counted].reverse().find((r) => r.event_type === 'check_out') ?? null;

  const { workedMinutes, hasOpenSession } = summarizeSessions(counted);

  return {
    status: resolveEventStatus(workedMinutes, thresholds, { hasOpenSession, dayFinished }),
    firstIn: firstInRow?.occurred_at ?? null,
    lastOut: lastOutRow?.occurred_at ?? null,
    workedMinutes,
    isLate:
      shift && firstInRow?.local_min != null
        ? isLateArrival(firstInRow.local_min, parseTimeToMinutes(shift.start_time), shift.grace_minutes)
        : false,
    isEarlyExit:
      shift && lastOutRow?.local_min != null
        ? isEarlyExit(lastOutRow.local_min, parseTimeToMinutes(shift.end_time), isNight)
        : false,
    hasOffWindowPunch,
    hasOpenSession,
    hasPendingFaceReview,
  };
}

/**
 * The tenant's status id for `status`. 'missed_punch' was added in schema 1.52.0
 * and reaches existing tenants through a one_time script; a tenant the script has
 * not reached yet falls back to 'absent' (also unpaid) rather than failing the
 * NOT NULL status_id write — and with it the nightly job for every tenant.
 */
export function statusIdSql(tenantId: string, status: string) {
  const own = sql`(SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${tenantId} AND name = ${status})`;
  if (status !== 'missed_punch') return own;
  return sql`COALESCE(${own}, (SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${tenantId} AND name = 'absent'))`;
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
        has_off_window_punch = EXCLUDED.has_off_window_punch, has_open_session = EXCLUDED.has_open_session,
        has_pending_face_review = EXCLUDED.has_pending_face_review,
        leave_request_id = EXCLUDED.leave_request_id, resolved_at = CLOCK_TIMESTAMP(),
        resolution_source = EXCLUDED.resolution_source, updated_at = CLOCK_TIMESTAMP()
        WHERE hr.attendance_days.resolution_source IS DISTINCT FROM 'regularization'`
    : sql`ON CONFLICT (user_id, work_date) DO NOTHING`;

  await tx.execute(sql`
    INSERT INTO hr.attendance_days
      (user_id, org_id, work_date, first_in, last_out, worked_minutes, status_id,
       is_late, is_early_exit, has_off_window_punch, has_open_session, has_pending_face_review,
       leave_request_id, resolved_at, resolution_source)
    VALUES
      (${emp.user_id}, ${emp.org_id}, ${date}::date, ${r.firstIn}, ${r.lastOut}, ${r.workedMinutes},
       ${statusIdSql(emp.tenant_id, r.status)},
       ${r.isLate}, ${r.isEarlyExit}, ${r.hasOffWindowPunch}, ${r.hasOpenSession}, ${r.hasPendingFaceReview},
       ${r.leaveRequestId}, CLOCK_TIMESTAMP(), ${r.source})
    ${onConflict}
  `);
}
