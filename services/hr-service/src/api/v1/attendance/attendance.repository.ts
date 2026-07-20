// ─────────────────────────────────────────────────────────────────────────────
// Attendance repository — all DB access for the attendance module.
//
// Conventions (mirroring services/hr-service/src/api/v1/leave):
//   - Own-scope reads go through withRoleTx so hr.* RLS scopes them.
//   - Punch writes (event insert + attendance_days upsert) and other cross-user
//     writes run in the SERVICE transaction (root_service, BYPASSRLS) because
//     attendance_days is service-write-only and the two writes must be atomic.
//     Authorization is enforced in the service layer; every query is explicitly
//     scoped by the gateway-verified org_id / user_id — never a client id.
//   - Multi-table reads use parameterized SQL (tx.execute) like the leave repo.
//   - "Today" and shift boundaries are computed in the org timezone via
//     Postgres `AT TIME ZONE` (DST-correct) and the lib/attendance/time helpers.
//
// Geofence + photo enforcement is IDENTICAL for check-in and check-out (punch()).
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, type RoleTxContext, type DrizzleTx } from '@platform/db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../lib/errors.js';
import { haversineMeters } from '../../../lib/geo/haversine.js';
import {
  localDateOf,
  localTimeMinutes,
  parseTimeToMinutes,
  workDateOf,
  isLateArrival,
  isEarlyExit,
} from '../../../lib/attendance/time.js';
import { resolveEventStatus, DEFAULT_THRESHOLDS, type ShiftThresholds } from '../../../lib/attendance/resolve.js';
import {
  computeDayResolution,
  upsertResolvedDay,
  type DayEmployee,
} from '../../../lib/attendance/day-resolution.js';
import { getPhotoStorage, detectImageExt } from '../../../lib/storage/photo-storage.js';
import { getFaceDriver, FaceEnrollmentError } from '../../../lib/face/index.js';
import { resolvePunchFace, FaceBlockedError, type FaceMatchAction, type FaceOutcome } from '../../../lib/face/punch-verification.js';
import { config } from '../../../config/index.js';
import type {
  CheckInInput,
  AttendanceRulesAdminInput,
  CreateShiftInput,
  UpdateShiftInput,
  CreateShiftAssignmentInput,
  UpdateShiftAssignmentInput,
  CreateRegularizationInput,
  ListRegularizationsInput,
  FaceReviewsQueryInput,
} from '@hr/validation';

export type AttendanceCtx = RoleTxContext & { rank: number };
type Row = Record<string, unknown>;

// ── Service-tx helper: sets the session GUCs hr.* triggers read ──────────────
async function serviceTxWithContext<T>(ctx: RoleTxContext, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return withServiceTx(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`);
    return fn(tx);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// RULES (org-effective; short in-process cache like require-module)
// ═════════════════════════════════════════════════════════════════════════════
export interface EffectiveRules {
  geofence_enabled: boolean;
  geofence_radius_meters: number;
  require_photo: boolean;
  require_geo: boolean;
  allow_wfh_checkin: boolean;
  require_face_match: boolean;
  face_match_threshold: number;
  face_match_action: string;
}

const DEFAULT_RULES: EffectiveRules = {
  geofence_enabled: true,
  geofence_radius_meters: 200,
  require_photo: true,
  require_geo: true,
  allow_wfh_checkin: false,
  require_face_match: false,
  face_match_threshold: 85,
  face_match_action: 'flag',
};

const RULES_TTL_MS = 60_000;
const rulesCache = new Map<string, { rules: EffectiveRules; expiresAt: number }>();

async function loadRulesRow(tx: DrizzleTx, orgId: string): Promise<EffectiveRules> {
  const rows = (await tx.execute(sql`
    SELECT geofence_enabled, geofence_radius_meters, require_photo, require_geo, allow_wfh_checkin,
           require_face_match, face_match_threshold::float8 AS face_match_threshold, face_match_action
    FROM hr.attendance_rules WHERE org_id = ${orgId} AND NOT is_deleted LIMIT 1
  `)) as unknown as EffectiveRules[];
  return rows[0] ?? { ...DEFAULT_RULES };
}

async function getCachedRules(orgId: string): Promise<EffectiveRules> {
  const now = Date.now();
  const cached = rulesCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.rules;
  const rules = await withServiceTx((tx) => loadRulesRow(tx, orgId));
  rulesCache.set(orgId, { rules, expiresAt: now + RULES_TTL_MS });
  return rules;
}

function invalidateRules(orgId: string): void {
  rulesCache.delete(orgId);
}

// ── Org geo + timezone ──────────────────────────────────────────────────────
interface OrgLoc {
  geo_lat: number | null;
  geo_lng: number | null;
  timezone: string;
}

async function loadOrg(tx: DrizzleTx, orgId: string): Promise<OrgLoc> {
  const rows = (await tx.execute(sql`
    SELECT geo_lat::float8 AS geo_lat, geo_lng::float8 AS geo_lng, timezone
    FROM entity.organizations WHERE id = ${orgId}
  `)) as unknown as OrgLoc[];
  if (!rows[0]) throw new NotFoundError('Organization not found');
  return rows[0];
}

// ── Current shift for a user on a date ──────────────────────────────────────
interface ShiftRow {
  id: string;
  name: string;
  start_time: string; // HH:MM:SS
  end_time: string;
  grace_minutes: number;
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  is_night_shift: boolean;
}

async function currentShift(tx: DrizzleTx, orgId: string, userId: string, date: string): Promise<ShiftRow | null> {
  const rows = (await tx.execute(sql`
    SELECT s.id::text, s.name, s.start_time::text, s.end_time::text, s.grace_minutes,
           s.min_half_day_minutes, s.min_full_day_minutes, s.is_night_shift
    FROM hr.shift_assignments sa
    JOIN hr.shifts s ON s.id = sa.shift_id AND NOT s.is_deleted AND s.is_active
    WHERE sa.user_id = ${userId} AND sa.org_id = ${orgId} AND NOT sa.is_deleted
      AND sa.effective_from <= ${date}::date
      AND (sa.effective_to IS NULL OR sa.effective_to >= ${date}::date)
    ORDER BY sa.effective_from DESC
    LIMIT 1
  `)) as unknown as ShiftRow[];
  return rows[0] ?? null;
}

function thresholdsFor(shift: ShiftRow | null): ShiftThresholds {
  if (!shift) return DEFAULT_THRESHOLDS;
  return { minHalfDayMinutes: shift.min_half_day_minutes, minFullDayMinutes: shift.min_full_day_minutes };
}

// SQL expression: the org-local work date of an attendance_events row `e`,
// accounting for night-shift midnight crossing (matches lib/attendance workDateOf).
function eventWorkDateSql(tz: string, isNight: boolean, shiftStartMin: number) {
  const local = sql`(e.occurred_at AT TIME ZONE ${tz})`;
  if (!isNight) return sql`(${local})::date`;
  return sql`CASE WHEN (EXTRACT(HOUR FROM ${local}) * 60 + EXTRACT(MINUTE FROM ${local})) < ${shiftStartMin}
                  THEN ((${local})::date - INTERVAL '1 day')::date
                  ELSE (${local})::date END`;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUNCH (check-in / check-out) — identical geofence + photo enforcement
// ═════════════════════════════════════════════════════════════════════════════
export interface PunchResult {
  event_id: string;
  work_date: string;
  event_type: 'check_in' | 'check_out';
  distance_from_org_m: number | null;
  is_within_geofence: boolean | null;
  is_wfh: boolean;
  photo_url: string | null;
  day_status: string;
  face_match_score: number | null;
  face_match_passed: boolean | null;
  face_review_status: string | null;
  // Set only when a flagged mismatch created a pending review; the service uses
  // it to notify the punching user's manager. Not part of the API response.
  notify_manager_id: string | null;
}

// Decode a base64 (optionally data:-URI-prefixed) photo body into bytes, enforcing
// the byte cap. Pure — no I/O — so it runs before we open any transaction.
export function decodePhoto(photo: string): Buffer {
  const raw = photo.includes(',') ? photo.slice(photo.indexOf(',') + 1) : photo;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    throw new BadRequestError('Invalid photo encoding (expected base64)');
  }
  if (buf.length === 0) throw new BadRequestError('Invalid photo (empty after decoding)');
  if (buf.length > config.photoMaxBytes) {
    throw new ValidationError(`Photo exceeds the ${config.photoMaxBytes}-byte limit`, { code: 'PHOTO_TOO_LARGE' });
  }
  return buf;
}

async function loadFaceSubjectId(tx: DrizzleTx, orgId: string, userId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT face_subject_id FROM hr.employee_profiles
    WHERE user_id = ${userId} AND org_id = ${orgId} AND NOT is_deleted
  `)) as unknown as Array<{ face_subject_id: string | null }>;
  return rows[0]?.face_subject_id ?? null;
}

async function loadManagerId(tx: DrizzleTx, userId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT manager_id::text AS manager_id FROM iam.users WHERE id = ${userId}
  `)) as unknown as Array<{ manager_id: string | null }>;
  return rows[0]?.manager_id ?? null;
}

export async function punch(
  ctx: AttendanceCtx,
  eventType: 'check_in' | 'check_out',
  data: CheckInInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<PunchResult> {
  const rules = await getCachedRules(ctx.org_id);

  // ── Phase 1: validate geo/photo, persist the photo, resolve the work date and
  //    the face subject. All reads/FS — no long-held tx across the network call. ──
  const prep = await serviceTxWithContext(ctx, async (tx) => {
    const org = await loadOrg(tx, ctx.org_id);

    // Geo enforcement (identical for both punch types).
    const hasCoords = data.geo_lat != null && data.geo_lng != null;
    if (rules.require_geo && !hasCoords) {
      throw new ValidationError('GEO_REQUIRED', { code: 'GEO_REQUIRED' });
    }

    let distance: number | null = null;
    let isWithin: boolean | null = null;
    const wfhBypass = data.is_wfh && rules.allow_wfh_checkin;

    if (hasCoords && org.geo_lat != null && org.geo_lng != null) {
      distance = Math.round(haversineMeters(org.geo_lat, org.geo_lng, data.geo_lat!, data.geo_lng!) * 100) / 100;
      isWithin = distance <= rules.geofence_radius_meters;
    }

    if (rules.geofence_enabled && !wfhBypass) {
      if (org.geo_lat == null || org.geo_lng == null) {
        throw new ValidationError(
          'ORG_LOCATION_NOT_SET: the organization has no geo coordinates. An org admin must set geo_lat/geo_lng before attendance can be captured.',
          { code: 'ORG_LOCATION_NOT_SET' },
        );
      }
      if (hasCoords && distance != null && distance > rules.geofence_radius_meters) {
        throw new ValidationError('OUTSIDE_GEOFENCE', {
          code: 'OUTSIDE_GEOFENCE',
          distance_m: distance,
          allowed_radius_m: rules.geofence_radius_meters,
        });
      }
    }

    // Photo enforcement (identical for both punch types).
    let photoKey: string | null = null;
    let photoBuf: Buffer | null = null;
    if (data.photo) {
      photoBuf = decodePhoto(data.photo);
      photoKey = await getPhotoStorage().put(photoBuf, detectImageExt(photoBuf));
    }
    if (rules.require_photo && !photoKey) {
      throw new ValidationError('PHOTO_REQUIRED', { code: 'PHOTO_REQUIRED' });
    }

    // Determine the work date (org tz + night-shift crossing).
    const now = new Date();
    const localToday = localDateOf(now, org.timezone);
    const shift = await currentShift(tx, ctx.org_id, ctx.user_id, localToday);
    const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
    const isNight = shift?.is_night_shift ?? false;
    const workDate = workDateOf(now, org.timezone, isNight, shiftStartMin);

    // Face subject (only needed when the rule is on AND a photo is present).
    const faceSubjectId =
      rules.require_face_match && photoBuf ? await loadFaceSubjectId(tx, ctx.org_id, ctx.user_id) : null;

    return { org, distance, isWithin, photoKey, photoBuf, workDate, isNight, shiftStartMin, shift, faceSubjectId };
  });

  // ── Phase 2: face verification OUTSIDE any DB transaction (the CompreFace call
  //    happens here; the event is written afterward with the result). ──
  let face: FaceOutcome = { score: null, passed: null, reviewStatus: null, notifyManager: false };
  if (rules.require_face_match && prep.photoBuf) {
    try {
      face = await resolvePunchFace({
        driver: getFaceDriver(),
        subjectId: prep.faceSubjectId,
        photo: prep.photoBuf,
        rules: { threshold: rules.face_match_threshold, action: rules.face_match_action as FaceMatchAction },
        log: (message, err) => console.error(message, (err as Error | undefined)?.message ?? err),
      });
    } catch (err) {
      if (err instanceof FaceBlockedError) {
        throw new ValidationError(err.code, { code: err.code, ...err.details });
      }
      throw err;
    }
  }

  // ── Phase 3: re-check open/closed guards, write the event with the face result,
  //    recompute the day. Guards are re-evaluated here so concurrency is still safe. ──
  return serviceTxWithContext(ctx, async (tx) => {
    const wd = eventWorkDateSql(prep.org.timezone, prep.isNight, prep.shiftStartMin);
    const counts = (await tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE e.event_type = 'check_in')::int  AS ci,
             COUNT(*) FILTER (WHERE e.event_type = 'check_out')::int AS co
      FROM hr.attendance_events e
      WHERE e.user_id = ${ctx.user_id} AND e.org_id = ${ctx.org_id} AND ${wd} = ${prep.workDate}::date
    `)) as unknown as Array<{ ci: number; co: number }>;
    const ci = counts[0]?.ci ?? 0;
    const co = counts[0]?.co ?? 0;

    if (eventType === 'check_in' && ci > co) {
      throw new ConflictError('You are already checked in (an open check-in exists for today)', {
        code: 'ALREADY_CHECKED_IN',
      });
    }
    if (eventType === 'check_out' && ci <= co) {
      throw new ConflictError('No open check-in to check out from', { code: 'NO_OPEN_CHECK_IN' });
    }

    const inserted = (await tx.execute(sql`
      INSERT INTO hr.attendance_events
        (user_id, org_id, event_type, source, geo_lat, geo_lng, distance_from_org_m,
         is_within_geofence, is_wfh, photo_url, face_match_score, face_match_passed, face_review_status,
         ip, device_info)
      VALUES
        (${ctx.user_id}, ${ctx.org_id}, ${eventType}, ${data.source},
         ${data.geo_lat ?? null}, ${data.geo_lng ?? null}, ${prep.distance}, ${prep.isWithin},
         ${data.is_wfh}, ${prep.photoKey}, ${face.score}, ${face.passed}, ${face.reviewStatus},
         ${meta.ip}, ${sql`${JSON.stringify({ user_agent: meta.userAgent })}::jsonb`})
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    const eventId = inserted[0]!.id;

    // Recompute + upsert today's attendance_days row (excludes rejected events).
    const dayStatus = await upsertDayFromEvents(tx, {
      userId: ctx.user_id,
      orgId: ctx.org_id,
      tenantId: ctx.tenant_id,
      workDate: prep.workDate,
      tz: prep.org.timezone,
      isNight: prep.isNight,
      shiftStartMin: prep.shiftStartMin,
      shift: prep.shift,
    });

    const notifyManagerId = face.notifyManager ? await loadManagerId(tx, ctx.user_id) : null;

    return {
      event_id: eventId,
      work_date: prep.workDate,
      event_type: eventType,
      distance_from_org_m: prep.distance,
      is_within_geofence: prep.isWithin,
      is_wfh: data.is_wfh,
      photo_url: prep.photoKey,
      day_status: dayStatus,
      face_match_score: face.score,
      face_match_passed: face.passed,
      face_review_status: face.reviewStatus,
      notify_manager_id: notifyManagerId,
    };
  });
}

// Recompute first_in/last_out/worked/status/late/early for a (user, work_date) from
// its events and upsert attendance_days. Never overwrites a 'regularization' row.
async function upsertDayFromEvents(
  tx: DrizzleTx,
  p: {
    userId: string;
    orgId: string;
    tenantId: string;
    workDate: string;
    tz: string;
    isNight: boolean;
    shiftStartMin: number;
    shift: ShiftRow | null;
  },
): Promise<string> {
  const wd = eventWorkDateSql(p.tz, p.isNight, p.shiftStartMin);
  const agg = (await tx.execute(sql`
    SELECT
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'check_in')  AS first_in,
      MAX(e.occurred_at) FILTER (WHERE e.event_type = 'check_out') AS last_out,
      (EXTRACT(HOUR FROM (MIN(e.occurred_at) FILTER (WHERE e.event_type = 'check_in')  AT TIME ZONE ${p.tz})) * 60
       + EXTRACT(MINUTE FROM (MIN(e.occurred_at) FILTER (WHERE e.event_type = 'check_in')  AT TIME ZONE ${p.tz})))::int AS first_in_min,
      (EXTRACT(HOUR FROM (MAX(e.occurred_at) FILTER (WHERE e.event_type = 'check_out') AT TIME ZONE ${p.tz})) * 60
       + EXTRACT(MINUTE FROM (MAX(e.occurred_at) FILTER (WHERE e.event_type = 'check_out') AT TIME ZONE ${p.tz})))::int AS last_out_min
    FROM hr.attendance_events e
    WHERE e.user_id = ${p.userId} AND e.org_id = ${p.orgId}
      AND e.face_review_status IS DISTINCT FROM 'rejected'
      AND ${wd} = ${p.workDate}::date
  `)) as unknown as Array<{
    first_in: string | null;
    last_out: string | null;
    first_in_min: number | null;
    last_out_min: number | null;
  }>;
  const row = agg[0]!;

  let workedMinutes: number | null = null;
  if (row.first_in && row.last_out) {
    workedMinutes = Math.max(0, Math.round((Date.parse(row.last_out) - Date.parse(row.first_in)) / 60_000));
  }

  const statusName = resolveEventStatus(workedMinutes, thresholdsFor(p.shift));

  let isLate = false;
  let isEarly = false;
  if (p.shift && row.first_in_min != null) {
    isLate = isLateArrival(row.first_in_min, parseTimeToMinutes(p.shift.start_time), p.shift.grace_minutes);
  }
  if (p.shift && row.last_out_min != null) {
    isEarly = isEarlyExit(row.last_out_min, parseTimeToMinutes(p.shift.end_time), p.isNight);
  }

  await tx.execute(sql`
    INSERT INTO hr.attendance_days
      (user_id, org_id, work_date, first_in, last_out, worked_minutes, status_id,
       is_late, is_early_exit, resolved_at, resolution_source)
    VALUES
      (${p.userId}, ${p.orgId}, ${p.workDate}::date, ${row.first_in}, ${row.last_out}, ${workedMinutes},
       (SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${p.tenantId} AND name = ${statusName}),
       ${isLate}, ${isEarly}, CLOCK_TIMESTAMP(), 'events')
    ON CONFLICT (user_id, work_date) DO UPDATE SET
      first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out, worked_minutes = EXCLUDED.worked_minutes,
      status_id = EXCLUDED.status_id, is_late = EXCLUDED.is_late, is_early_exit = EXCLUDED.is_early_exit,
      resolved_at = CLOCK_TIMESTAMP(), resolution_source = 'events', updated_at = CLOCK_TIMESTAMP()
    WHERE hr.attendance_days.resolution_source IS DISTINCT FROM 'regularization'
  `);

  return statusName;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULES — read (any user) / admin upsert
// ═════════════════════════════════════════════════════════════════════════════
export async function getEffectiveRules(ctx: AttendanceCtx): Promise<EffectiveRules> {
  return getCachedRules(ctx.org_id);
}

export async function upsertRules(ctx: AttendanceCtx, data: AttendanceRulesAdminInput): Promise<EffectiveRules> {
  const result = await serviceTxWithContext(ctx, async (tx) => {
    await tx.execute(sql`
      INSERT INTO hr.attendance_rules
        (org_id, geofence_enabled, geofence_radius_meters, require_photo, require_geo, allow_wfh_checkin,
         require_face_match, face_match_threshold, face_match_action, created_by)
      VALUES
        (${ctx.org_id}, ${data.geofence_enabled}, ${data.geofence_radius_meters}, ${data.require_photo},
         ${data.require_geo}, ${data.allow_wfh_checkin},
         ${data.require_face_match ?? false}, ${data.face_match_threshold ?? 85}, ${data.face_match_action ?? 'flag'},
         ${ctx.user_id})
      ON CONFLICT (org_id) WHERE NOT is_deleted DO UPDATE SET
        geofence_enabled = EXCLUDED.geofence_enabled,
        geofence_radius_meters = EXCLUDED.geofence_radius_meters,
        require_photo = EXCLUDED.require_photo,
        require_geo = EXCLUDED.require_geo,
        allow_wfh_checkin = EXCLUDED.allow_wfh_checkin,
        require_face_match = EXCLUDED.require_face_match,
        face_match_threshold = EXCLUDED.face_match_threshold,
        face_match_action = EXCLUDED.face_match_action,
        updated_at = CLOCK_TIMESTAMP()
    `);
    return loadRulesRow(tx, ctx.org_id);
  });
  invalidateRules(ctx.org_id);
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// ME — own attendance for a month + holiday/weekly-off overlay
// ═════════════════════════════════════════════════════════════════════════════
export async function getMyMonth(ctx: AttendanceCtx, month: string) {
  return withRoleTx(ctx, async (tx) => {
    const first = `${month}-01`;
    const days = (await tx.execute(sql`
      SELECT ad.work_date::text, ad.first_in, ad.last_out, ad.worked_minutes,
             st.name AS status_name, st.label AS status_label,
             ad.is_late, ad.is_early_exit, ad.leave_request_id::text, ad.resolution_source
      FROM hr.attendance_days ad
      JOIN hr.attendance_statuses st ON st.id = ad.status_id
      WHERE ad.user_id = ${ctx.user_id} AND ad.org_id = ${ctx.org_id}
        AND ad.work_date >= ${first}::date
        AND ad.work_date < (${first}::date + INTERVAL '1 month')
      ORDER BY ad.work_date
    `)) as unknown as Row[];

    const holidays = (await tx.execute(sql`
      SELECT DISTINCT holiday_date::text AS d, name
      FROM hr.holidays
      WHERE org_id = ${ctx.org_id} AND is_active AND NOT is_deleted AND NOT is_optional
        AND holiday_date >= ${first}::date AND holiday_date < (${first}::date + INTERVAL '1 month')
      ORDER BY d
    `)) as unknown as Row[];

    const offRows = (await tx.execute(sql`
      SELECT weekly_off_pattern AS p FROM hr.employee_profiles
      WHERE user_id = ${ctx.user_id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as Array<{ p: number[] }>;

    return {
      month,
      days,
      holidays,
      weekly_off_pattern: offRows[0]?.p ?? [0, 6],
    };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// TEAM — org dashboard for a date, authority-scoped (service tx after authz)
// ═════════════════════════════════════════════════════════════════════════════
export async function getTeam(ctx: AttendanceCtx, date: string, seeAllOrg: boolean) {
  return withServiceTx(async (tx) => {
    const scopeClause = seeAllOrg
      ? sql``
      : sql`AND EXISTS (
          SELECT 1 FROM iam.vw_user_team_members m
          WHERE m.manager_id = ${ctx.user_id} AND m.member_id = ep.user_id AND m.org_id = ${ctx.org_id}
        )`;
    return (await tx.execute(sql`
      SELECT ep.user_id::text, u.full_name AS user_full_name, u.email AS user_email,
             ${date}::date AS work_date,
             ad.first_in, ad.last_out, ad.worked_minutes,
             COALESCE(st.name, 'not_marked')  AS status_name,
             COALESCE(st.label, 'Not Marked') AS status_label,
             COALESCE(ad.is_late, FALSE)       AS is_late,
             COALESCE(ad.is_early_exit, FALSE) AS is_early_exit
      FROM hr.employee_profiles ep
      JOIN iam.users u ON u.id = ep.user_id
      LEFT JOIN hr.attendance_days ad ON ad.user_id = ep.user_id AND ad.work_date = ${date}::date
      LEFT JOIN hr.attendance_statuses st ON st.id = ad.status_id
      WHERE ep.org_id = ${ctx.org_id} AND ep.is_active AND NOT ep.is_deleted
      ${scopeClause}
      ORDER BY u.full_name
    `)) as unknown as Row[];
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// PHOTO — load an event's photo key after an authority check
// ═════════════════════════════════════════════════════════════════════════════
export async function loadEventForPhoto(ctx: AttendanceCtx, eventId: string): Promise<{ user_id: string; photo_url: string } | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT user_id::text, photo_url FROM hr.attendance_events
      WHERE id = ${eventId} AND org_id = ${ctx.org_id}
    `)) as unknown as Array<{ user_id: string; photo_url: string | null }>;
    const row = rows[0];
    if (!row || !row.photo_url) return null;
    return { user_id: row.user_id, photo_url: row.photo_url };
  });
}

export async function canViewUserAttendance(ctx: AttendanceCtx, targetUserId: string): Promise<boolean> {
  if (targetUserId === ctx.user_id) return true;
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1 FROM iam.vw_user_team_members
      WHERE manager_id = ${ctx.user_id} AND member_id = ${targetUserId} AND org_id = ${ctx.org_id}
      LIMIT 1
    `)) as unknown as Row[];
    return rows.length > 0;
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHIFTS
// ═════════════════════════════════════════════════════════════════════════════
export async function listShifts(ctx: AttendanceCtx) {
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT id::text, org_id::text, name, start_time::text, end_time::text, grace_minutes,
             min_half_day_minutes, min_full_day_minutes, is_night_shift, is_active
      FROM hr.shifts WHERE org_id = ${ctx.org_id} AND NOT is_deleted
      ORDER BY name
    `)) as unknown as Row[];
  });
}

export async function createShift(ctx: AttendanceCtx, data: CreateShiftInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.shifts
          (org_id, name, start_time, end_time, grace_minutes, min_half_day_minutes, min_full_day_minutes, is_night_shift, created_by)
        VALUES
          (${ctx.org_id}, ${data.name}, ${data.start_time}, ${data.end_time}, ${data.grace_minutes},
           ${data.min_half_day_minutes}, ${data.min_full_day_minutes}, ${data.is_night_shift}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('A shift with that name already exists in this org');
      }
      throw err;
    }
  });
}

export async function updateShift(ctx: AttendanceCtx, id: string, data: UpdateShiftInput): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const sets: ReturnType<typeof sql>[] = [];
    if (data.name !== undefined) sets.push(sql`name = ${data.name}`);
    if (data.start_time !== undefined) sets.push(sql`start_time = ${data.start_time}`);
    if (data.end_time !== undefined) sets.push(sql`end_time = ${data.end_time}`);
    if (data.grace_minutes !== undefined) sets.push(sql`grace_minutes = ${data.grace_minutes}`);
    if (data.min_half_day_minutes !== undefined) sets.push(sql`min_half_day_minutes = ${data.min_half_day_minutes}`);
    if (data.min_full_day_minutes !== undefined) sets.push(sql`min_full_day_minutes = ${data.min_full_day_minutes}`);
    if (data.is_night_shift !== undefined) sets.push(sql`is_night_shift = ${data.is_night_shift}`);
    if (data.is_active !== undefined) sets.push(sql`is_active = ${data.is_active}`);
    if (sets.length === 0) return;
    const res = (await tx.execute(sql`
      UPDATE hr.shifts SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
      RETURNING id::text
    `)) as unknown as Row[];
    if (res.length === 0) throw new NotFoundError('Shift not found');
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHIFT ASSIGNMENTS
// ═════════════════════════════════════════════════════════════════════════════
export async function listShiftAssignments(ctx: AttendanceCtx, userId?: string) {
  return withServiceTx(async (tx) => {
    const userClause = userId ? sql`AND sa.user_id = ${userId}` : sql``;
    return (await tx.execute(sql`
      SELECT sa.id::text, sa.user_id::text, u.full_name AS user_full_name, sa.shift_id::text,
             s.name AS shift_name, sa.effective_from::text, sa.effective_to::text, sa.is_active
      FROM hr.shift_assignments sa
      JOIN iam.users u ON u.id = sa.user_id
      JOIN hr.shifts s ON s.id = sa.shift_id
      WHERE sa.org_id = ${ctx.org_id} AND NOT sa.is_deleted ${userClause}
      ORDER BY sa.effective_from DESC
    `)) as unknown as Row[];
  });
}

export async function createShiftAssignment(ctx: AttendanceCtx, data: CreateShiftAssignmentInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    // Shift must belong to this org.
    const shiftOk = (await tx.execute(sql`
      SELECT 1 FROM hr.shifts WHERE id = ${data.shift_id} AND org_id = ${ctx.org_id} AND NOT is_deleted LIMIT 1
    `)) as unknown as Row[];
    if (shiftOk.length === 0) throw new BadRequestError('Shift not found in this org');
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.shift_assignments (user_id, org_id, shift_id, effective_from, effective_to, created_by)
        VALUES (${data.user_id}, ${ctx.org_id}, ${data.shift_id}, ${data.effective_from}, ${data.effective_to ?? null}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if ((err as { code?: string }).code === '23P01') {
        throw new ConflictError('This user already has a shift assignment overlapping those dates');
      }
      throw err;
    }
  });
}

export async function updateShiftAssignment(ctx: AttendanceCtx, id: string, data: UpdateShiftAssignmentInput): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const sets: ReturnType<typeof sql>[] = [];
    if (data.shift_id !== undefined) sets.push(sql`shift_id = ${data.shift_id}`);
    if (data.effective_from !== undefined) sets.push(sql`effective_from = ${data.effective_from}`);
    if (data.effective_to !== undefined) sets.push(sql`effective_to = ${data.effective_to}`);
    if (data.is_active !== undefined) sets.push(sql`is_active = ${data.is_active}`);
    if (sets.length === 0) return;
    try {
      const res = (await tx.execute(sql`
        UPDATE hr.shift_assignments SET ${sql.join(sets, sql`, `)}
        WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
        RETURNING id::text
      `)) as unknown as Row[];
      if (res.length === 0) throw new NotFoundError('Shift assignment not found');
    } catch (err) {
      if ((err as { code?: string }).code === '23P01') {
        throw new ConflictError('This change would overlap another shift assignment for the user');
      }
      throw err;
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// REGULARIZATIONS
// ═════════════════════════════════════════════════════════════════════════════
export async function createRegularization(ctx: AttendanceCtx, data: CreateRegularizationInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    const statusSub = data.requested_status_name
      ? sql`(SELECT id FROM hr.attendance_statuses WHERE name = ${data.requested_status_name})`
      : sql`NULL`;
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.attendance_regularizations
          (user_id, org_id, work_date, requested_status_id, requested_in, requested_out, reason, created_by)
        VALUES
          (${ctx.user_id}, ${ctx.org_id}, ${data.work_date}, ${statusSub},
           ${data.requested_in ?? null}, ${data.requested_out ?? null}, ${data.reason}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('You already have an open regularization for that date');
      }
      throw err;
    }
  });
}

export async function listRegularizations(ctx: AttendanceCtx, filters: ListRegularizationsInput, seeAllOrg: boolean) {
  const { scope, status, page, limit } = filters;
  const offset = (page - 1) * limit;
  const statusClause = status ? sql`AND r.status = ${status}` : sql``;

  if (scope === 'own') {
    return withRoleTx(ctx, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT r.id::text, r.user_id::text, r.work_date::text, r.requested_status_id::text,
               st.name AS requested_status_name, r.requested_in, r.requested_out, r.reason,
               r.status, r.approver_id::text, r.acted_at, r.approver_comment, r.created_at
        FROM hr.attendance_regularizations r
        LEFT JOIN hr.attendance_statuses st ON st.id = r.requested_status_id
        WHERE r.user_id = ${ctx.user_id} AND NOT r.is_deleted ${statusClause}
        ORDER BY r.work_date DESC, r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)) as unknown as Row[];
      const countRows = (await tx.execute(sql`
        SELECT COUNT(*)::int AS count FROM hr.attendance_regularizations r
        WHERE r.user_id = ${ctx.user_id} AND NOT r.is_deleted ${statusClause}
      `)) as unknown as Array<{ count: number }>;
      return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
    });
  }

  // Team scope: approver subtree, or whole org for hr_admin/org_admin.
  return withServiceTx(async (tx) => {
    const scopeClause = seeAllOrg
      ? sql``
      : sql`AND EXISTS (
          SELECT 1 FROM iam.vw_user_team_members m
          WHERE m.manager_id = ${ctx.user_id} AND m.member_id = r.user_id AND m.org_id = ${ctx.org_id}
        )`;
    const rows = (await tx.execute(sql`
      SELECT r.id::text, r.user_id::text, u.full_name AS user_full_name, r.work_date::text,
             r.requested_status_id::text, st.name AS requested_status_name,
             r.requested_in, r.requested_out, r.reason, r.status, r.approver_id::text,
             r.acted_at, r.approver_comment, r.created_at
      FROM hr.attendance_regularizations r
      JOIN iam.users u ON u.id = r.user_id
      LEFT JOIN hr.attendance_statuses st ON st.id = r.requested_status_id
      WHERE r.org_id = ${ctx.org_id} AND NOT r.is_deleted ${statusClause} ${scopeClause}
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM hr.attendance_regularizations r
      WHERE r.org_id = ${ctx.org_id} AND NOT r.is_deleted ${statusClause} ${scopeClause}
    `)) as unknown as Array<{ count: number }>;
    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

interface RegForAction {
  id: string;
  user_id: string;
  org_id: string;
  work_date: string;
  status: string;
  requested_status_id: string | null;
  requested_status_name: string | null;
  requested_in: string | null;
  requested_out: string | null;
}

async function loadRegForAction(tx: DrizzleTx, id: string): Promise<RegForAction | null> {
  const rows = (await tx.execute(sql`
    SELECT r.id::text, r.user_id::text, r.org_id::text, r.work_date::text, r.status,
           r.requested_status_id::text, st.name AS requested_status_name,
           r.requested_in::text, r.requested_out::text
    FROM hr.attendance_regularizations r
    LEFT JOIN hr.attendance_statuses st ON st.id = r.requested_status_id
    WHERE r.id = ${id} AND NOT r.is_deleted
  `)) as unknown as RegForAction[];
  return rows[0] ?? null;
}

async function canApprove(tx: DrizzleTx, orgId: string, approverId: string, requesterId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT hr.can_approve(${orgId}, ${approverId}, ${requesterId}) AS ok
  `)) as unknown as Array<{ ok: boolean }>;
  return rows[0]?.ok ?? false;
}

export interface RegDecision {
  regularization_id: string;
  requester_id: string;
  org_id: string;
  work_date: string;
  day_flipped: boolean;
}

export async function approveRegularization(
  ctx: AttendanceCtx,
  id: string,
  comment: string | null,
  isOverride: boolean,
): Promise<RegDecision> {
  return serviceTxWithContext(ctx, async (tx) => {
    const reg = await loadRegForAction(tx, id);
    if (!reg) throw new NotFoundError('Regularization not found');
    if (reg.org_id !== ctx.org_id) throw new NotFoundError('Regularization not found');
    if (reg.status !== 'pending') throw new ConflictError(`Regularization is already ${reg.status}`);
    if (!isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, reg.user_id))) {
      throw new ForbiddenError('You are not authorized to approve this regularization');
    }

    await tx.execute(sql`
      UPDATE hr.attendance_regularizations
      SET status = 'approved', approver_id = ${ctx.user_id}, acted_at = CLOCK_TIMESTAMP(), approver_comment = ${comment}
      WHERE id = ${id}
    `);

    // Apply the requested values to attendance_days (resolution_source='regularization').
    let flipped = false;
    if (reg.requested_status_name) {
      let worked: number | null = null;
      if (reg.requested_in && reg.requested_out) {
        worked = Math.max(0, Math.round((Date.parse(reg.requested_out) - Date.parse(reg.requested_in)) / 60_000));
      }
      await tx.execute(sql`
        INSERT INTO hr.attendance_days
          (user_id, org_id, work_date, first_in, last_out, worked_minutes, status_id, resolved_at, resolution_source)
        VALUES
          (${reg.user_id}, ${ctx.org_id}, ${reg.work_date}::date, ${reg.requested_in}, ${reg.requested_out}, ${worked},
           (SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${ctx.tenant_id} AND name = ${reg.requested_status_name}),
           CLOCK_TIMESTAMP(), 'regularization')
        ON CONFLICT (user_id, work_date) DO UPDATE SET
          first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out, worked_minutes = EXCLUDED.worked_minutes,
          status_id = EXCLUDED.status_id, resolved_at = CLOCK_TIMESTAMP(),
          resolution_source = 'regularization', updated_at = CLOCK_TIMESTAMP()
      `);
      flipped = true;
    }

    return {
      regularization_id: id,
      requester_id: reg.user_id,
      org_id: reg.org_id,
      work_date: reg.work_date,
      day_flipped: flipped,
    };
  });
}

export async function rejectRegularization(
  ctx: AttendanceCtx,
  id: string,
  comment: string,
  isOverride: boolean,
): Promise<RegDecision> {
  return serviceTxWithContext(ctx, async (tx) => {
    const reg = await loadRegForAction(tx, id);
    if (!reg) throw new NotFoundError('Regularization not found');
    if (reg.org_id !== ctx.org_id) throw new NotFoundError('Regularization not found');
    if (reg.status !== 'pending') throw new ConflictError(`Regularization is already ${reg.status}`);
    if (!isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, reg.user_id))) {
      throw new ForbiddenError('You are not authorized to act on this regularization');
    }
    await tx.execute(sql`
      UPDATE hr.attendance_regularizations
      SET status = 'rejected', approver_id = ${ctx.user_id}, acted_at = CLOCK_TIMESTAMP(), approver_comment = ${comment}
      WHERE id = ${id}
    `);
    return { regularization_id: id, requester_id: reg.user_id, org_id: reg.org_id, work_date: reg.work_date, day_flipped: false };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// REPORTS — monthly summary (payroll export source)
// ═════════════════════════════════════════════════════════════════════════════
export async function monthlySummary(ctx: AttendanceCtx, month: string) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT user_id::text, user_full_name, user_email, month,
             present_count, absent_count, half_day_count, on_leave_count, holiday_count,
             weekly_off_count, wfh_count, late_count, early_exit_count,
             avg_worked_minutes::float8 AS avg_worked_minutes
      FROM hr.vw_attendance_monthly_summary
      WHERE org_id = ${ctx.org_id} AND month = ${month}
      ORDER BY user_full_name
    `)) as unknown as Row[];
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// FACE — enrollment / status / unenroll
//
// The CompreFace subject id is the user's UUID. The external driver calls run
// OUTSIDE the DB transaction; the profile columns are written only after the
// subject has been (re)created, so a partial enrollment never leaves the profile
// pointing at a subject that does not exist.
// ═════════════════════════════════════════════════════════════════════════════
export interface FaceEnrollResult {
  user_id: string;
  face_subject_id: string;
  face_enrolled_at: string;
}

async function assertEmployeeInOrg(tx: DrizzleTx, orgId: string, userId: string): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM hr.employee_profiles
    WHERE user_id = ${userId} AND org_id = ${orgId} AND NOT is_deleted LIMIT 1
  `)) as unknown as Row[];
  if (rows.length === 0) throw new NotFoundError('Employee profile not found in this org');
}

export async function enrollFace(ctx: AttendanceCtx, userId: string, photoBuf: Buffer): Promise<FaceEnrollResult> {
  // 1. Confirm the target is an employee of this org (own-org authorization is
  //    enforced in the service; this is the existence/tenancy check).
  await serviceTxWithContext(ctx, (tx) => assertEmployeeInOrg(tx, ctx.org_id, userId));

  const subjectId = userId; // subject id === user UUID
  const driver = getFaceDriver();

  // 2. (Re)create the subject OUTSIDE any tx: replace faces (delete then add).
  try {
    await driver.deleteSubject(subjectId);
    await driver.enrollSubject(subjectId, photoBuf);
  } catch (err) {
    if (err instanceof FaceEnrollmentError) {
      throw new BadRequestError('No detectable face in the reference photo', { code: 'FACE_NO_FACE' });
    }
    throw new ValidationError('Face verification service is unavailable; try again later', {
      code: 'FACE_SERVICE_UNAVAILABLE',
    });
  }

  // 3. Persist the reference photo + profile columns (consent recorded now).
  const refKey = await getPhotoStorage().put(photoBuf, detectImageExt(photoBuf));
  return serviceTxWithContext(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      UPDATE hr.employee_profiles
      SET reference_photo_url = ${refKey}, face_subject_id = ${subjectId},
          face_enrolled_at = CLOCK_TIMESTAMP(), face_consent_at = CLOCK_TIMESTAMP(),
          updated_at = CLOCK_TIMESTAMP()
      WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND NOT is_deleted
      RETURNING user_id::text, face_subject_id, face_enrolled_at::text
    `)) as unknown as Array<{ user_id: string; face_subject_id: string; face_enrolled_at: string }>;
    const row = rows[0]!;
    return { user_id: row.user_id, face_subject_id: row.face_subject_id, face_enrolled_at: row.face_enrolled_at };
  });
}

export interface FaceStatus {
  user_id: string;
  enrolled: boolean;
  face_enrolled_at: string | null;
  face_consent_at: string | null;
  has_reference_photo: boolean;
}

export async function getFaceStatus(ctx: AttendanceCtx, userId: string): Promise<FaceStatus> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT user_id::text, face_subject_id, face_enrolled_at::text, face_consent_at::text, reference_photo_url
      FROM hr.employee_profiles
      WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as Array<{
      user_id: string;
      face_subject_id: string | null;
      face_enrolled_at: string | null;
      face_consent_at: string | null;
      reference_photo_url: string | null;
    }>;
    const row = rows[0];
    if (!row) throw new NotFoundError('Employee profile not found in this org');
    return {
      user_id: row.user_id,
      enrolled: row.face_subject_id != null,
      face_enrolled_at: row.face_enrolled_at,
      face_consent_at: row.face_consent_at,
      has_reference_photo: row.reference_photo_url != null,
    };
  });
}

export async function deleteFaceEnrollment(ctx: AttendanceCtx, userId: string): Promise<void> {
  const subjectId = await serviceTxWithContext(ctx, async (tx) => {
    await assertEmployeeInOrg(tx, ctx.org_id, userId);
    return loadFaceSubjectId(tx, ctx.org_id, userId);
  });

  // Drop the CompreFace subject first (idempotent — driver tolerates 404).
  if (subjectId) {
    try {
      await getFaceDriver().deleteSubject(subjectId);
    } catch (err) {
      throw new ValidationError('Face verification service is unavailable; try again later', {
        code: 'FACE_SERVICE_UNAVAILABLE',
        detail: (err as Error).message,
      });
    }
  }

  await serviceTxWithContext(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE hr.employee_profiles
      SET reference_photo_url = NULL, face_subject_id = NULL, face_enrolled_at = NULL, face_consent_at = NULL,
          updated_at = CLOCK_TIMESTAMP()
      WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `);
  });
}

/** Reference-photo storage key for a user (for the authenticated serving route). */
export async function loadReferencePhotoKey(ctx: AttendanceCtx, userId: string): Promise<{ user_id: string; key: string } | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT user_id::text, reference_photo_url FROM hr.employee_profiles
      WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as Array<{ user_id: string; reference_photo_url: string | null }>;
    const row = rows[0];
    if (!row || !row.reference_photo_url) return null;
    return { user_id: row.user_id, key: row.reference_photo_url };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// FACE REVIEWS — queue + clear/reject (same approval authority as regularizations)
// ═════════════════════════════════════════════════════════════════════════════
export async function listFaceReviews(ctx: AttendanceCtx, filters: FaceReviewsQueryInput, seeAllOrg: boolean) {
  const { status, page, limit } = filters;
  const offset = (page - 1) * limit;
  return withServiceTx(async (tx) => {
    const scopeClause = seeAllOrg
      ? sql``
      : sql`AND EXISTS (
          SELECT 1 FROM iam.vw_user_team_members m
          WHERE m.manager_id = ${ctx.user_id} AND m.member_id = e.user_id AND m.org_id = ${ctx.org_id}
        )`;
    const rows = (await tx.execute(sql`
      SELECT e.id::text AS event_id, e.user_id::text, u.full_name AS user_full_name, u.email AS user_email,
             e.event_type, e.occurred_at, e.face_match_score::float8 AS face_match_score,
             e.face_review_status, e.photo_url, ep.reference_photo_url
      FROM hr.attendance_events e
      JOIN iam.users u ON u.id = e.user_id
      LEFT JOIN hr.employee_profiles ep ON ep.user_id = e.user_id AND ep.org_id = e.org_id
      WHERE e.org_id = ${ctx.org_id} AND e.face_review_status = ${status} ${scopeClause}
      ORDER BY e.occurred_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM hr.attendance_events e
      WHERE e.org_id = ${ctx.org_id} AND e.face_review_status = ${status} ${scopeClause}
    `)) as unknown as Array<{ count: number }>;
    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

export interface FaceReviewDecision {
  event_id: string;
  user_id: string;
  work_date: string | null;
  day_recomputed: boolean;
}

interface FaceEventForAction {
  id: string;
  user_id: string;
  org_id: string;
  occurred_at: string;
  face_review_status: string | null;
}

async function loadFaceEventForAction(tx: DrizzleTx, id: string): Promise<FaceEventForAction | null> {
  const rows = (await tx.execute(sql`
    SELECT id::text, user_id::text, org_id::text, occurred_at::text, face_review_status
    FROM hr.attendance_events WHERE id = ${id}
  `)) as unknown as FaceEventForAction[];
  return rows[0] ?? null;
}

async function assertCanActOnFaceReview(
  tx: DrizzleTx,
  ctx: AttendanceCtx,
  evt: FaceEventForAction,
  isOverride: boolean,
): Promise<void> {
  if (!evt || evt.org_id !== ctx.org_id) throw new NotFoundError('Face review not found');
  if (evt.face_review_status !== 'pending') {
    throw new ConflictError(`Face review is already ${evt.face_review_status ?? 'resolved'}`);
  }
  if (!isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, evt.user_id))) {
    throw new ForbiddenError('You are not authorized to act on this face review');
  }
}

export async function clearFaceReview(ctx: AttendanceCtx, eventId: string, isOverride: boolean): Promise<FaceReviewDecision> {
  return serviceTxWithContext(ctx, async (tx) => {
    const evt = await loadFaceEventForAction(tx, eventId);
    await assertCanActOnFaceReview(tx, ctx, evt!, isOverride);
    await tx.execute(sql`
      UPDATE hr.attendance_events SET face_review_status = 'cleared' WHERE id = ${eventId}
    `);
    return { event_id: eventId, user_id: evt!.user_id, work_date: null, day_recomputed: false };
  });
}

export async function rejectFaceReview(ctx: AttendanceCtx, eventId: string, isOverride: boolean): Promise<FaceReviewDecision> {
  return serviceTxWithContext(ctx, async (tx) => {
    const evt = await loadFaceEventForAction(tx, eventId);
    await assertCanActOnFaceReview(tx, ctx, evt!, isOverride);

    // Mark the punch invalid, then recompute that user's day excluding it.
    await tx.execute(sql`
      UPDATE hr.attendance_events SET face_review_status = 'rejected' WHERE id = ${eventId}
    `);

    const org = await loadOrg(tx, ctx.org_id);
    const occurred = new Date(evt!.occurred_at);
    const localToday = localDateOf(occurred, org.timezone);
    const shift = await currentShift(tx, ctx.org_id, evt!.user_id, localToday);
    const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
    const isNight = shift?.is_night_shift ?? false;
    const workDate = workDateOf(occurred, org.timezone, isNight, shiftStartMin);

    const offRows = (await tx.execute(sql`
      SELECT weekly_off_pattern AS p FROM hr.employee_profiles
      WHERE user_id = ${evt!.user_id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as Array<{ p: number[] }>;

    const emp: DayEmployee = {
      user_id: evt!.user_id,
      org_id: ctx.org_id,
      tenant_id: ctx.tenant_id,
      timezone: org.timezone,
      weekly_off_pattern: offRows[0]?.p ?? [0, 6],
    };
    const resolution = await computeDayResolution(tx, emp, workDate);
    await upsertResolvedDay(tx, emp, workDate, resolution, { overwrite: true });

    return { event_id: eventId, user_id: evt!.user_id, work_date: workDate, day_recomputed: true };
  });
}
