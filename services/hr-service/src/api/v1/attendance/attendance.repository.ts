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
  addDays,
  localDateOf,
  localTimeMinutes,
  parseTimeToMinutes,
  workDateOf,
  isLateArrival,
  isEarlyExit,
} from '../../../lib/attendance/time.js';
import { DEFAULT_THRESHOLDS, thresholdsFrom, type ShiftThresholds } from '../../../lib/attendance/resolve.js';
import { matchSegment, validateSegments, type ShiftSegment } from '../../../lib/attendance/segments.js';
import { punchEligibility } from '../../../lib/attendance/punch-eligibility.js';
// Regularizations escalate up the same hierarchy leave does — one resolver,
// reading iam.reporting_lines, shared by both.
import { resolveApprovers } from '../../../lib/leave/resolve-approvers.js';
import {
  computeDayResolution,
  deriveFromEvents,
  upsertResolvedDay,
  type DayEmployee,
  type DayEventRow,
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
  UpdateRegularizationInput,
  ListRegularizationsInput,
  FaceReviewsQueryInput,
} from '@hr/validation';

// `capabilities` (Tier C3) rides along so the service-layer gates can ask the
// DB-resolved matrix instead of comparing ranks.
export type AttendanceCtx = RoleTxContext & { rank: number; capabilities: string[] };
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
  photo_change_cooldown_days: number;
  image_retention_days: number;
  // Org-level day-classification fallback, used when the employee has NO shift
  // assignment. An assigned shift's own thresholds always win (see thresholdsFrom).
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  // How far back a regularization may be filed, in days, counted in `timezone`
  // below. 0 = today only. Enforced in attendance.service.createRegularization,
  // which also rejects any future work_date.
  regularization_max_backdate_days: number;
  // Levels of the reporting chain that must approve a regularization; 1 = direct
  // manager. Read here rather than by its own query so org-over-tenant
  // precedence is resolved in exactly one place.
  regularization_approval_levels: number;
  // The org's IANA timezone. Attendance work_date and shift boundaries are
  // computed in this zone server-side (see workDateOf), so the client must use
  // it to derive "today" — using the browser's UTC date mismatched the stored
  // work_date during the UTC+ evening window and hid a just-made check-in.
  timezone: string;
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
  photo_change_cooldown_days: 30,
  image_retention_days: 90,
  min_half_day_minutes: DEFAULT_THRESHOLDS.minHalfDayMinutes,
  min_full_day_minutes: DEFAULT_THRESHOLDS.minFullDayMinutes,
  regularization_max_backdate_days: 30,
  regularization_approval_levels: 1,
  timezone: 'Asia/Kolkata',
};

/** The org-level thresholds carried on the effective rules, in ShiftThresholds shape. */
function orgThresholdsOf(rules: EffectiveRules): ShiftThresholds {
  return {
    minHalfDayMinutes: rules.min_half_day_minutes,
    minFullDayMinutes: rules.min_full_day_minutes,
  };
}

const RULES_TTL_MS = 60_000;
const rulesCache = new Map<string, { rules: EffectiveRules; expiresAt: number }>();

async function loadRulesRow(tx: DrizzleTx, orgId: string): Promise<EffectiveRules> {
  // Always resolve the org timezone (from entity.organizations); the
  // attendance_rules row is optional and its columns are NULL when unset.
  //
  // Two rows can apply: the org's own override and the tenant-wide default
  // (org_id NULL). The org row wins WHOLE — precedence is per row, not per
  // column, the same way hr.hr_settings resolves. Column-level merging would
  // mean an org override could not turn a setting back OFF once the tenant
  // default had it on, and "which value is in force" would stop being
  // answerable by looking at one row.
  const rows = (await tx.execute(sql`
    SELECT o.timezone,
           r.geofence_enabled, r.geofence_radius_meters, r.require_photo, r.require_geo, r.allow_wfh_checkin,
           r.require_face_match, r.face_match_threshold::float8 AS face_match_threshold, r.face_match_action,
           r.photo_change_cooldown_days, r.image_retention_days,
           r.min_half_day_minutes, r.min_full_day_minutes,
           r.regularization_max_backdate_days, r.regularization_approval_levels
    FROM entity.organizations o
    LEFT JOIN LATERAL (
      SELECT ar.*
      FROM hr.attendance_rules ar
      WHERE ar.tenant_id = o.tenant_id
        AND NOT ar.is_deleted
        AND (ar.org_id = o.id OR ar.org_id IS NULL)
      -- FALSE sorts before TRUE, so the org row (org_id NOT NULL) comes first.
      ORDER BY (ar.org_id IS NULL)
      LIMIT 1
    ) r ON TRUE
    WHERE o.id = ${orgId} LIMIT 1
  `)) as unknown as Array<Partial<EffectiveRules> & { timezone: string | null; geofence_enabled: boolean | null }>;
  const row = rows[0];
  if (!row) return { ...DEFAULT_RULES };
  const timezone = row.timezone ?? DEFAULT_RULES.timezone;
  // No attendance_rules row → fall back to defaults, but keep the real org tz.
  if (row.geofence_enabled === null || row.geofence_enabled === undefined) {
    return { ...DEFAULT_RULES, timezone };
  }
  return { ...(row as EffectiveRules), timezone };
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

// A tenant-wide write changes the effective rules of every org that has no
// override, and this process has no cheap way to know which those are — the
// cache is keyed by org, not by the row it came from. Clearing all of it costs
// one reload per active org and the entries live 60s anyway.
function invalidateAllRules(): void {
  rulesCache.clear();
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
  is_split: boolean;
}

async function currentShift(tx: DrizzleTx, orgId: string, userId: string, date: string): Promise<ShiftRow | null> {
  const rows = (await tx.execute(sql`
    SELECT s.id::text, s.name, s.start_time::text, s.end_time::text, s.grace_minutes,
           s.min_half_day_minutes, s.min_full_day_minutes, s.is_night_shift, s.is_split
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

/** Count of one punch type already recorded for a (user, work_date). */
async function countPunches(
  tx: DrizzleTx,
  ctx: AttendanceCtx,
  workDate: string,
  tz: string,
  isNight: boolean,
  shiftStartMin: number,
  eventType: 'check_in' | 'check_out',
): Promise<number> {
  const wd = eventWorkDateSql(tz, isNight, shiftStartMin);
  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM hr.attendance_events e
    WHERE e.user_id = ${ctx.user_id} AND e.org_id = ${ctx.org_id}
      AND e.event_type = ${eventType} AND ${wd} = ${workDate}::date
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Ordered, non-deleted segments of a shift. Empty for a non-split shift. */
async function loadSegments(tx: DrizzleTx, shiftId: string): Promise<ShiftSegment[]> {
  return (await tx.execute(sql`
    SELECT seq, start_time::text, end_time::text
    FROM hr.shift_segments
    WHERE shift_id = ${shiftId} AND NOT is_deleted AND is_active
    ORDER BY seq
  `)) as unknown as ShiftSegment[];
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

// Who to notify about this user's punch: their direct manager in this org.
//
// Reads the hierarchy itself rather than iam.users.manager_id, which is only a
// display mirror and, for someone who works in more than one branch, may name
// the manager of a different org than the one they just punched in.
async function loadManagerId(tx: DrizzleTx, userId: string, orgId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT manager_id::text AS manager_id
    FROM iam.fn_manager_chain(${userId}::uuid)
    WHERE org_id = ${orgId}::uuid AND depth = 1
    LIMIT 1
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

    // Photo enforcement (identical for both punch types). Decode now for the
    // required-photo check; the bytes are stored after the work date is known so
    // the key keeps its retention-friendly `punch/<user>/<YYYYMMDD>_…` shape.
    let photoKey: string | null = null;
    let photoBuf: Buffer | null = null;
    if (data.photo) {
      photoBuf = decodePhoto(data.photo);
    }
    if (rules.require_photo && !photoBuf) {
      throw new ValidationError('PHOTO_REQUIRED', { code: 'PHOTO_REQUIRED' });
    }

    // Determine the work date (org tz + night-shift crossing).
    const now = new Date();
    const localToday = localDateOf(now, org.timezone);
    const shift = await currentShift(tx, ctx.org_id, ctx.user_id, localToday);
    const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
    const isNight = shift?.is_night_shift ?? false;
    const workDate = workDateOf(now, org.timezone, isNight, shiftStartMin);

    // Split-shift segment match. NULL when there is no shift or no segments, so a
    // non-split employee is never flagged. An off-window punch is accepted and its
    // minutes still count — the flag only surfaces the day for review.
    const segments = shift ? await loadSegments(tx, shift.id) : [];
    const isOffSegment =
      segments.length > 0
        ? matchSegment(localTimeMinutes(now, org.timezone), segments, shift!.grace_minutes, shiftStartMin) === null
        : null;

    // How many punches of this type the day already has. Drives both the unique
    // photo key below and the non-split second-pair guard in Phase 3.
    const priorSameType = await countPunches(tx, ctx, workDate, org.timezone, isNight, shiftStartMin, eventType);

    if (photoBuf) {
      const compact = workDate.replace(/-/g, '');
      const kind = eventType === 'check_in' ? 'chkin' : 'chkout';
      const ext = detectImageExt(photoBuf);
      // A split shift punches several times a day, so the key MUST carry a
      // sequence — the old fixed `<date>_chkin` overwrote the earlier session's
      // selfie. The YYYYMMDD prefix stays leading: msq-deploy/retention/
      // retention-cleanup.sh ages selfies out by parsing the date off the front.
      photoKey = await getPhotoStorage().putAt(
        `punch/${ctx.user_id}/${compact}_${kind}_${priorSameType + 1}.${ext}`,
        photoBuf,
      );
    }

    // Face subject (only needed when the rule is on AND a photo is present).
    const faceSubjectId =
      rules.require_face_match && photoBuf ? await loadFaceSubjectId(tx, ctx.org_id, ctx.user_id) : null;

    return {
      org, distance, isWithin, photoKey, photoBuf, workDate, isNight, shiftStartMin, shift,
      faceSubjectId, isOffSegment, segmentCount: segments.length,
    };
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

    // The gates themselves live in lib/attendance/punch-eligibility so that the
    // dashboard's GET /attendance/today-state reports exactly what this enforces.
    // Duplicating them client-side is what made a split shift read "Completed for
    // today" after segment 1 while this code would still have accepted segment 2.
    const eligibility = punchEligibility(
      { checkIns: ci, checkOuts: co },
      {
        hasShift: !!prep.shift,
        isSplit: prep.shift?.is_split ?? false,
        segmentCount: prep.segmentCount,
      },
    );

    if (eventType === 'check_in' && !eligibility.canCheckIn) {
      const message =
        eligibility.checkInBlockedBy === 'ALREADY_CHECKED_IN'
          ? 'You are already checked in (an open check-in exists for today)'
          : eligibility.checkInBlockedBy === 'SEGMENT_LIMIT_REACHED'
            ? 'You have already punched every segment of your shift for today'
            : 'You have already completed a check-in and check-out for today';
      throw new ConflictError(message, {
        code: eligibility.checkInBlockedBy!,
        ...(eligibility.checkInBlockedBy === 'SEGMENT_LIMIT_REACHED'
          ? { segments: prep.segmentCount }
          : {}),
      });
    }
    if (eventType === 'check_out' && !eligibility.canCheckOut) {
      throw new ConflictError('No open check-in to check out from', { code: 'NO_OPEN_CHECK_IN' });
    }

    const inserted = (await tx.execute(sql`
      INSERT INTO hr.attendance_events
        (user_id, org_id, event_type, source, geo_lat, geo_lng, distance_from_org_m,
         is_within_geofence, is_wfh, photo_url, face_match_score, face_match_passed, face_review_status,
         is_off_segment, ip, device_info)
      VALUES
        (${ctx.user_id}, ${ctx.org_id}, ${eventType}, ${data.source},
         ${data.geo_lat ?? null}, ${data.geo_lng ?? null}, ${prep.distance}, ${prep.isWithin},
         ${data.is_wfh}, ${prep.photoKey}, ${face.score}, ${face.passed}, ${face.reviewStatus},
         ${prep.isOffSegment}, ${meta.ip}, ${sql`${JSON.stringify({ user_agent: meta.userAgent })}::jsonb`})
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
      orgThresholds: orgThresholdsOf(rules),
    });

    const notifyManagerId = face.notifyManager ? await loadManagerId(tx, ctx.user_id, ctx.org_id) : null;

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
    orgThresholds: ShiftThresholds;
  },
): Promise<string> {
  const wd = eventWorkDateSql(p.tz, p.isNight, p.shiftStartMin);
  // The full ordered punch list, not MIN/MAX aggregates — worked minutes are the
  // sum of paired sessions, which needs every event in sequence. 'pending' rows
  // are SELECTED but not counted; deriveFromEvents needs to see them to flag the
  // day, so the filter stays at 'rejected' rather than excluding both here.
  const rows = (await tx.execute(sql`
    SELECT e.occurred_at::text AS occurred_at,
           e.event_type,
           e.is_off_segment,
           e.face_review_status,
           (EXTRACT(HOUR   FROM (e.occurred_at AT TIME ZONE ${p.tz})) * 60
          + EXTRACT(MINUTE FROM (e.occurred_at AT TIME ZONE ${p.tz})))::int AS local_min
    FROM hr.attendance_events e
    WHERE e.user_id = ${p.userId} AND e.org_id = ${p.orgId}
      AND e.face_review_status IS DISTINCT FROM 'rejected'
      AND ${wd} = ${p.workDate}::date
    ORDER BY e.occurred_at
  `)) as unknown as DayEventRow[];

  // Same derivation the nightly job and the face-review recompute use, so all
  // three write paths agree by construction.
  const d = deriveFromEvents(rows, p.shift, p.isNight, thresholdsFrom(p.shift, p.orgThresholds));

  await tx.execute(sql`
    INSERT INTO hr.attendance_days
      (user_id, org_id, work_date, first_in, last_out, worked_minutes, status_id,
       is_late, is_early_exit, has_off_window_punch, has_open_session, has_pending_face_review,
       resolved_at, resolution_source)
    VALUES
      (${p.userId}, ${p.orgId}, ${p.workDate}::date, ${d.firstIn}, ${d.lastOut}, ${d.workedMinutes},
       (SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${p.tenantId} AND name = ${d.status}),
       ${d.isLate}, ${d.isEarlyExit}, ${d.hasOffWindowPunch}, ${d.hasOpenSession}, ${d.hasPendingFaceReview},
       CLOCK_TIMESTAMP(), 'events')
    ON CONFLICT (user_id, work_date) DO UPDATE SET
      first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out, worked_minutes = EXCLUDED.worked_minutes,
      status_id = EXCLUDED.status_id, is_late = EXCLUDED.is_late, is_early_exit = EXCLUDED.is_early_exit,
      has_off_window_punch = EXCLUDED.has_off_window_punch, has_open_session = EXCLUDED.has_open_session,
      has_pending_face_review = EXCLUDED.has_pending_face_review,
      resolved_at = CLOCK_TIMESTAMP(), resolution_source = 'events', updated_at = CLOCK_TIMESTAMP()
    WHERE hr.attendance_days.resolution_source IS DISTINCT FROM 'regularization'
  `);

  return d.status;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULES — read (any user) / admin upsert
// ═════════════════════════════════════════════════════════════════════════════
export async function getEffectiveRules(ctx: AttendanceCtx): Promise<EffectiveRules> {
  return getCachedRules(ctx.org_id);
}

export async function upsertRules(ctx: AttendanceCtx, data: AttendanceRulesAdminInput): Promise<EffectiveRules> {
  // scope='tenant' writes the row every org without an override inherits; the
  // caller has already checked the platform role for it (see service.updateRules).
  const scope = data.scope ?? 'org';
  const orgId = scope === 'org' ? ctx.org_id : null;
  const result = await serviceTxWithContext(ctx, async (tx) => {
    await tx.execute(sql`
      INSERT INTO hr.attendance_rules
        (tenant_id, org_id, geofence_enabled, geofence_radius_meters, require_photo, require_geo, allow_wfh_checkin,
         require_face_match, face_match_threshold, face_match_action,
         photo_change_cooldown_days, image_retention_days,
         min_half_day_minutes, min_full_day_minutes,
         regularization_max_backdate_days, regularization_approval_levels, created_by)
      VALUES
        (${ctx.tenant_id}, ${orgId}, ${data.geofence_enabled}, ${data.geofence_radius_meters}, ${data.require_photo},
         ${data.require_geo}, ${data.allow_wfh_checkin},
         ${data.require_face_match ?? false}, ${data.face_match_threshold ?? 85}, ${data.face_match_action ?? 'flag'},
         ${data.photo_change_cooldown_days ?? 30}, ${data.image_retention_days ?? 90},
         ${data.min_half_day_minutes ?? DEFAULT_THRESHOLDS.minHalfDayMinutes},
         ${data.min_full_day_minutes ?? DEFAULT_THRESHOLDS.minFullDayMinutes},
         ${data.regularization_max_backdate_days ?? DEFAULT_RULES.regularization_max_backdate_days},
         ${data.regularization_approval_levels ?? DEFAULT_RULES.regularization_approval_levels},
         ${ctx.user_id})
      ON CONFLICT (tenant_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
        WHERE NOT is_deleted
      DO UPDATE SET
        geofence_enabled = EXCLUDED.geofence_enabled,
        geofence_radius_meters = EXCLUDED.geofence_radius_meters,
        require_photo = EXCLUDED.require_photo,
        require_geo = EXCLUDED.require_geo,
        allow_wfh_checkin = EXCLUDED.allow_wfh_checkin,
        require_face_match = EXCLUDED.require_face_match,
        face_match_threshold = EXCLUDED.face_match_threshold,
        face_match_action = EXCLUDED.face_match_action,
        photo_change_cooldown_days = EXCLUDED.photo_change_cooldown_days,
        image_retention_days = EXCLUDED.image_retention_days,
        min_half_day_minutes = EXCLUDED.min_half_day_minutes,
        min_full_day_minutes = EXCLUDED.min_full_day_minutes,
        regularization_max_backdate_days = EXCLUDED.regularization_max_backdate_days,
        regularization_approval_levels = EXCLUDED.regularization_approval_levels,
        updated_at = CLOCK_TIMESTAMP()
    `);
    return loadRulesRow(tx, ctx.org_id);
  });
  // A tenant write can change what OTHER orgs read, so their cached copies go too.
  if (scope === 'tenant') invalidateAllRules();
  else invalidateRules(ctx.org_id);
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// ME — own attendance for a month + holiday/weekly-off overlay
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Re-resolve a date range that has ALREADY been resolved.
 *
 * The nightly job deliberately cannot do this: it skips any date with an
 * existing hr.attendance_days row and passes overwrite:false, so once someone
 * has punched, their day is frozen against later configuration changes. That is
 * the right default, but it means assigning or correcting a shift never
 * reclassifies the days it should now apply to.
 *
 * Uses overwrite:true, which by construction leaves rows whose resolution_source
 * is 'regularization' untouched — an approved manual correction always outranks
 * a recompute.
 *
 * Unlike the job, today IS in range: the whole point is to reclassify a day the
 * employee has already punched under a shift that was assigned after the fact.
 */
export async function recomputeAttendance(
  ctx: AttendanceCtx,
  args: { user_id?: string | undefined; from: string; to: string },
) {
  return withServiceTx(async (tx) => {
    const userClause = args.user_id ? sql`AND ep.user_id = ${args.user_id}` : sql``;
    const employees = (await tx.execute(sql`
      SELECT ep.user_id::text, ep.org_id::text, ep.tenant_id::text, o.timezone,
             ep.weekly_off_pattern AS weekly_off_pattern
      FROM hr.employee_profiles ep
      JOIN entity.organizations o ON o.id = ep.org_id
      WHERE ep.org_id = ${ctx.org_id} AND ep.is_active AND NOT ep.is_deleted ${userClause}
    `)) as unknown as DayEmployee[];

    const thresholdRows = (await tx.execute(sql`
      SELECT min_half_day_minutes, min_full_day_minutes
      FROM hr.attendance_rules WHERE org_id = ${ctx.org_id} AND NOT is_deleted LIMIT 1
    `)) as unknown as Array<{ min_half_day_minutes: number; min_full_day_minutes: number }>;
    const thresholds = thresholdRows[0]
      ? {
          minHalfDayMinutes: thresholdRows[0].min_half_day_minutes,
          minFullDayMinutes: thresholdRows[0].min_full_day_minutes,
        }
      : undefined;

    let daysProcessed = 0;
    const statuses: Record<string, number> = {};

    for (const emp of employees) {
      for (let d = args.from; d <= args.to; d = addDays(d, 1)) {
        const r = await computeDayResolution(tx, emp, d, thresholds);
        await upsertResolvedDay(tx, emp, d, r, { overwrite: true });
        daysProcessed += 1;
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      }
    }

    return {
      employees_processed: employees.length,
      days_processed: daysProcessed,
      statuses,
    };
  });
}

/**
 * Today's punch state for the caller: what the next punch may be, and how far
 * through a split shift's segments they are.
 *
 * Derived from the SAME inputs the punch path uses (org timezone, the shift
 * effective today, its declared segments, and the per-work-date event counts)
 * and gated by the SAME punchEligibility rule, so the button the dashboard
 * renders always matches what checkIn/checkOut would actually accept.
 */
export async function getTodayPunchState(ctx: AttendanceCtx) {
  return serviceTxWithContext(ctx, async (tx) => {
    const org = await loadOrg(tx, ctx.org_id);
    const now = new Date();
    const localToday = localDateOf(now, org.timezone);
    const shift = await currentShift(tx, ctx.org_id, ctx.user_id, localToday);
    const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
    const isNight = shift?.is_night_shift ?? false;
    const workDate = workDateOf(now, org.timezone, isNight, shiftStartMin);
    const segments = shift ? await loadSegments(tx, shift.id) : [];

    const checkIns = await countPunches(tx, ctx, workDate, org.timezone, isNight, shiftStartMin, 'check_in');
    const checkOuts = await countPunches(tx, ctx, workDate, org.timezone, isNight, shiftStartMin, 'check_out');

    const e = punchEligibility(
      { checkIns, checkOuts },
      { hasShift: !!shift, isSplit: shift?.is_split ?? false, segmentCount: segments.length },
    );

    return {
      work_date: workDate,
      shift_id: shift?.id ?? null,
      shift_name: shift?.name ?? null,
      is_split: shift?.is_split ?? false,
      segments: segments.map((s) => ({ seq: s.seq, start_time: s.start_time, end_time: s.end_time })),
      check_ins: checkIns,
      check_outs: checkOuts,
      can_check_in: e.canCheckIn,
      can_check_out: e.canCheckOut,
      check_in_blocked_by: e.checkInBlockedBy,
      has_open_session: e.hasOpenSession,
      segments_punched: e.segmentsPunched,
      segments_total: e.segmentsTotal,
    };
  });
}

export async function getMyMonth(ctx: AttendanceCtx, month: string) {
  return withRoleTx(ctx, async (tx) => {
    const first = `${month}-01`;
    const days = (await tx.execute(sql`
      SELECT ad.work_date::text, ad.first_in, ad.last_out, ad.worked_minutes,
             st.name AS status_name, st.label AS status_label,
             ad.is_late, ad.is_early_exit, ad.has_off_window_punch, ad.has_open_session,
             ad.has_pending_face_review,
             ad.leave_request_id::text, ad.resolution_source
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
    // The check-in / check-out events are located by exact timestamp match on the
    // day's first_in / last_out, so no tz bucketing is needed here. We surface the
    // check-in face-match score (the meaningful one) plus each event's id + device
    // geo, and whether the user has an avatar (drives the grid thumbnail).
    return (await tx.execute(sql`
      SELECT ep.user_id::text, u.full_name AS user_full_name, u.email AS user_email,
             ${date}::date AS work_date,
             ad.first_in, ad.last_out, ad.worked_minutes,
             COALESCE(st.name, 'not_marked')  AS status_name,
             COALESCE(st.label, 'Not Marked') AS status_label,
             COALESCE(ad.is_late, FALSE)       AS is_late,
             COALESCE(ad.is_early_exit, FALSE) AS is_early_exit,
             COALESCE(ad.has_off_window_punch, FALSE) AS has_off_window_punch,
             COALESCE(ad.has_open_session, FALSE)     AS has_open_session,
             -- Day-level, so it catches a mismatch on ANY punch. The e_in lateral
             -- below is pinned to first_in and is blind to a split shift's middle
             -- punches — exactly where buddy-punching happens.
             COALESCE(ad.has_pending_face_review, FALSE) AS has_pending_face_review,
             (u.photo_key IS NOT NULL)         AS has_photo,
             (ep.face_subject_id IS NOT NULL)  AS enrolled,
             e_in.id::text  AS checkin_event_id,
             e_in.face_match_score::float8 AS face_match_score,
             e_in.face_review_status       AS face_review_status,
             e_in.geo_lat::float8 AS checkin_lat, e_in.geo_lng::float8 AS checkin_lng,
             e_out.id::text AS checkout_event_id,
             e_out.geo_lat::float8 AS checkout_lat, e_out.geo_lng::float8 AS checkout_lng
      FROM hr.employee_profiles ep
      JOIN iam.users u ON u.id = ep.user_id
      LEFT JOIN hr.attendance_days ad ON ad.user_id = ep.user_id AND ad.work_date = ${date}::date
      LEFT JOIN hr.attendance_statuses st ON st.id = ad.status_id
      LEFT JOIN LATERAL (
        SELECT id, face_match_score, face_review_status, geo_lat, geo_lng
        FROM hr.attendance_events
        WHERE user_id = ep.user_id AND event_type = 'check_in' AND occurred_at = ad.first_in
        LIMIT 1
      ) e_in ON TRUE
      LEFT JOIN LATERAL (
        SELECT id, geo_lat, geo_lng
        FROM hr.attendance_events
        WHERE user_id = ep.user_id AND event_type = 'check_out' AND occurred_at = ad.last_out
        LIMIT 1
      ) e_out ON TRUE
      WHERE ep.org_id = ${ctx.org_id} AND ep.is_active AND NOT ep.is_deleted
      ${scopeClause}
      ORDER BY u.full_name
    `)) as unknown as Row[];
  });
}

export interface TodaySummary {
  present: number;
  checked_in: number;
  checked_out: number;
  half_day: number;
  on_leave: number;
  wfh: number;
  absent: number;
  not_marked: number;
}

// One row of counts for the "my day" tiles, over the same roster and scope rule
// as getTeam. Aggregating here rather than in the client keeps the org/manager
// scoping server-side and avoids shipping every employee's row to render six
// numbers.
//
// `wfh` is derived from hr.attendance_events.is_wfh, not from a status: the
// attendance_statuses catalog has no 'wfh' member (present / half_day / on_leave
// / absent / holiday / weekly_off), and a work-from-home punch is an ordinary
// present day flagged on the event. It therefore OVERLAPS `present` by design —
// the same person is both — which is how vw_attendance_monthly_summary already
// reports wfh_count.
export async function getTodaySummary(
  ctx: AttendanceCtx,
  date: string,
  seeAllOrg: boolean,
): Promise<TodaySummary> {
  return withServiceTx(async (tx) => {
    const scopeClause = seeAllOrg
      ? sql``
      : sql`AND EXISTS (
          SELECT 1 FROM iam.vw_user_team_members m
          WHERE m.manager_id = ${ctx.user_id} AND m.member_id = ep.user_id AND m.org_id = ${ctx.org_id}
        )`;
    const rows = (await tx.execute(sql`
      WITH roster AS (
        SELECT ep.user_id
        FROM hr.employee_profiles ep
        WHERE ep.org_id = ${ctx.org_id} AND ep.is_active AND NOT ep.is_deleted
        ${scopeClause}
      ),
      day AS (
        SELECT r.user_id, ad.first_in, ad.last_out, st.name AS status_name
        FROM roster r
        LEFT JOIN hr.attendance_days ad
               ON ad.user_id = r.user_id AND ad.work_date = ${date}::date
        LEFT JOIN hr.attendance_statuses st ON st.id = ad.status_id
      ),
      wfh AS (
        SELECT DISTINCT e.user_id
        FROM hr.attendance_events e
        JOIN roster r ON r.user_id = e.user_id
        WHERE e.org_id = ${ctx.org_id}
          AND e.is_wfh
          AND e.occurred_at >= ${date}::date
          AND e.occurred_at <  (${date}::date + INTERVAL '1 day')
      )
      SELECT
        COUNT(*) FILTER (WHERE d.status_name = 'present')                      AS present,
        -- checked in but not yet out = still on the clock
        COUNT(*) FILTER (WHERE d.first_in IS NOT NULL AND d.last_out IS NULL)  AS checked_in,
        COUNT(*) FILTER (WHERE d.last_out IS NOT NULL)                         AS checked_out,
        COUNT(*) FILTER (WHERE d.status_name = 'half_day')                     AS half_day,
        COUNT(*) FILTER (WHERE d.status_name = 'on_leave')                     AS on_leave,
        (SELECT COUNT(*) FROM wfh)                                             AS wfh,
        COUNT(*) FILTER (WHERE d.status_name = 'absent')                       AS absent,
        COUNT(*) FILTER (WHERE d.status_name IS NULL)                          AS not_marked
      FROM day d
    `)) as unknown as Array<Record<string, string | number>>;

    const r = rows[0] ?? {};
    const n = (v: unknown) => Number(v ?? 0);
    return {
      present: n(r['present']),
      checked_in: n(r['checked_in']),
      checked_out: n(r['checked_out']),
      half_day: n(r['half_day']),
      on_leave: n(r['on_leave']),
      wfh: n(r['wfh']),
      absent: n(r['absent']),
      not_marked: n(r['not_marked']),
    };
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

/**
 * Every punch of one employee's work date, oldest first.
 *
 * The team view exposes only two event ids — the check-in matching first_in and
 * the check-out matching last_out — so on a split shift the middle punches' photos
 * are stored but unaddressable, and the second-segment check-in is precisely where
 * buddy-punching happens. This returns the whole day so a reviewer can open any of
 * them.
 *
 * `photo_url` itself never leaves the server: the client fetches bytes through
 * /attendance/photos/:eventId, so only a has_photo boolean is exposed. Rejected
 * punches ARE included — a reviewer looking into a suspected buddy-punch needs to
 * see the punch that was thrown out.
 */
export async function listDayEvents(ctx: AttendanceCtx, userId: string, date: string) {
  return withServiceTx(async (tx) => {
    const org = await loadOrg(tx, ctx.org_id);
    // Bucket by the same work-date expression the rollup uses, so a night shift's
    // post-midnight punches belong to the date the employee actually worked.
    const shift = await currentShift(tx, ctx.org_id, userId, date);
    const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
    const wd = eventWorkDateSql(org.timezone, shift?.is_night_shift ?? false, shiftStartMin);

    return (await tx.execute(sql`
      SELECT e.id::text AS event_id, e.event_type, e.occurred_at,
             e.face_match_score::float8 AS face_match_score,
             e.face_match_passed, e.face_review_status, e.is_off_segment,
             e.is_within_geofence, e.distance_from_org_m::float8 AS distance_from_org_m,
             e.geo_lat::float8 AS geo_lat, e.geo_lng::float8 AS geo_lng,
             (e.photo_url IS NOT NULL) AS has_photo
      FROM hr.attendance_events e
      WHERE e.user_id = ${userId} AND e.org_id = ${ctx.org_id}
        AND ${wd} = ${date}::date
      ORDER BY e.occurred_at
    `)) as unknown as Row[];
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
    const shifts = (await tx.execute(sql`
      SELECT id::text, org_id::text, name, start_time::text, end_time::text, grace_minutes,
             min_half_day_minutes, min_full_day_minutes, is_night_shift, is_split, is_active
      FROM hr.shifts WHERE org_id = ${ctx.org_id} AND NOT is_deleted
      ORDER BY name
    `)) as unknown as Array<Row & { id: string }>;
    if (shifts.length === 0) return shifts;

    // One extra query for every segment in the org, grouped in memory — not one
    // query per shift.
    const segs = (await tx.execute(sql`
      SELECT shift_id::text, seq, start_time::text, end_time::text
      FROM hr.shift_segments
      WHERE org_id = ${ctx.org_id} AND NOT is_deleted AND is_active
      ORDER BY shift_id, seq
    `)) as unknown as Array<ShiftSegment & { shift_id: string }>;

    const byShift = new Map<string, ShiftSegment[]>();
    for (const s of segs) {
      const list = byShift.get(s.shift_id) ?? [];
      list.push({ seq: s.seq, start_time: s.start_time, end_time: s.end_time });
      byShift.set(s.shift_id, list);
    }
    return shifts.map((s) => ({ ...s, segments: byShift.get(s.id) ?? [] }));
  });
}

/**
 * Replace a shift's segment set wholesale: retire what is there, write the new
 * rows. Validated against the window the shift will actually have after this
 * request, since updateShift is a partial update that may be changing it in the
 * same call.
 *
 * Retiring means is_active = FALSE, NOT is_deleted = TRUE. The RLS policies on
 * hr.shift_segments carry `NOT is_deleted` in their USING clause, so an UPDATE
 * that sets is_deleted produces a row the policy no longer admits and Postgres
 * rejects the statement outright ("new row violates row-level security policy")
 * — soft delete is simply not available to an app-tier role on this table.
 * is_active is the flag the policy leaves free, and both readers (loadSegments
 * and listShifts) already require it.
 */
async function replaceSegments(
  tx: DrizzleTx,
  ctx: AttendanceCtx,
  shiftId: string,
  segments: ShiftSegment[],
  windowStart: string,
  windowEnd: string,
): Promise<void> {
  const problem = validateSegments(segments, windowStart, windowEnd);
  if (problem) throw new BadRequestError(problem);

  await tx.execute(sql`
    UPDATE hr.shift_segments SET is_active = FALSE, updated_at = CLOCK_TIMESTAMP()
    WHERE shift_id = ${shiftId} AND org_id = ${ctx.org_id} AND NOT is_deleted AND is_active
  `);

  // A retired row keeps its (shift_id, seq) slot — uix_shift_segments_shift_seq
  // is partial on NOT is_deleted, not on is_active — so a seq that comes back is
  // revived in place instead of colliding with its own retired predecessor.
  for (const seg of segments) {
    await tx.execute(sql`
      INSERT INTO hr.shift_segments (shift_id, org_id, seq, start_time, end_time, created_by)
      VALUES (${shiftId}, ${ctx.org_id}, ${seg.seq}, ${seg.start_time}, ${seg.end_time}, ${ctx.user_id})
      ON CONFLICT (shift_id, seq) WHERE NOT is_deleted DO UPDATE
        SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
            is_active = TRUE, updated_at = CLOCK_TIMESTAMP()
    `);
  }
}

export async function createShift(ctx: AttendanceCtx, data: CreateShiftInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.shifts
          (org_id, name, start_time, end_time, grace_minutes, min_half_day_minutes, min_full_day_minutes,
           is_night_shift, is_split, created_by)
        VALUES
          (${ctx.org_id}, ${data.name}, ${data.start_time}, ${data.end_time}, ${data.grace_minutes},
           ${data.min_half_day_minutes}, ${data.min_full_day_minutes}, ${data.is_night_shift},
           ${data.is_split ?? false}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      const id = rows[0]!.id;

      if (data.is_split) {
        await replaceSegments(tx, ctx, id, data.segments ?? [], data.start_time, data.end_time);
      }
      return { id };
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
    if (data.is_split !== undefined) sets.push(sql`is_split = ${data.is_split}`);
    if (data.is_active !== undefined) sets.push(sql`is_active = ${data.is_active}`);

    // The stored row is needed either way: to 404, and to resolve the window a
    // partial update leaves unchanged.
    const existing = (await tx.execute(sql`
      SELECT start_time::text, end_time::text, is_split
      FROM hr.shifts WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as Array<{ start_time: string; end_time: string; is_split: boolean }>;
    if (existing.length === 0) throw new NotFoundError('Shift not found');
    const cur = existing[0]!;

    if (sets.length > 0) {
      await tx.execute(sql`
        UPDATE hr.shifts SET ${sql.join(sets, sql`, `)}
        WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
      `);
    }

    const isSplit = data.is_split ?? cur.is_split;
    if (data.segments !== undefined && isSplit) {
      await replaceSegments(
        tx,
        ctx,
        id,
        data.segments,
        data.start_time ?? cur.start_time,
        data.end_time ?? cur.end_time,
      );
    } else if (data.is_split === false) {
      // Turning split off retires the segments so a later re-enable can't
      // resurrect a stale set that no longer fits the window. is_active rather
      // than is_deleted, for the RLS reason spelled out on replaceSegments.
      await tx.execute(sql`
        UPDATE hr.shift_segments SET is_active = FALSE, updated_at = CLOCK_TIMESTAMP()
        WHERE shift_id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted AND is_active
      `);
    }
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
      // 23P01 exclusion_violation (overlapping date range) and 23505 unique_violation
      // (exact duplicate) both mean the same thing to the caller: this assignment
      // already exists. Map to 409 rather than leaking a raw 500. See Issue #3b.
      const code = (err as { code?: string }).code;
      if (code === '23P01' || code === '23505') {
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
// How many levels of the reporting chain must sign off. The direct counterpart
// of hr.leave_policies.approval_levels; 1 (direct manager) when neither the org
// nor its tenant has a rules row yet.
//
// Read through the effective rules rather than with its own `WHERE org_id =`
// query: since the tenant-wide default row has org_id NULL, a direct lookup
// would miss it and silently fall back to 1 for every org that inherits — which
// would quietly shorten the approval chain rather than fail visibly.
async function regularizationApprovalLevels(orgId: string): Promise<number> {
  return (await getCachedRules(orgId)).regularization_approval_levels;
}

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
      const id = rows[0]!.id;

      // Materialize the approver chain now, from iam.reporting_lines as of the
      // work date being corrected — the same resolver leave uses, so a
      // regularization escalates up exactly the hierarchy a leave request would.
      // Resolving at submit time means a later re-org cannot strand the request.
      const levels = await regularizationApprovalLevels(ctx.org_id);
      const approvers = await resolveApprovers(
        tx, ctx.org_id, ctx.user_id, levels, new Date(data.work_date),
      );
      for (const a of approvers) {
        await tx.execute(sql`
          INSERT INTO hr.attendance_regularization_approvals
            (regularization_id, org_id, level, approver_id)
          VALUES (${id}, ${ctx.org_id}, ${a.level}, ${a.approverId})
        `);
      }

      return { id };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('You already have an open regularization for that date');
      }
      throw err;
    }
  });
}

// Edit / withdraw, both restricted to the requester's OWN still-pending request.
// They run under withRoleTx so the self RLS policy — not an application-side
// `user_id = ...` we could forget — is what makes another user's row invisible;
// the status guard is a separate SELECT so "already approved" reports a 409
// instead of the 404 a no-op UPDATE would produce.
async function loadOwnPendingReg(tx: DrizzleTx, id: string): Promise<{ status: string } | null> {
  const rows = (await tx.execute(sql`
    SELECT status FROM hr.attendance_regularizations WHERE id = ${id} AND NOT is_deleted
  `)) as unknown as Array<{ status: string }>;
  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'pending') {
    throw new ConflictError(`This request is already ${row.status} and can no longer be changed`);
  }
  return row;
}

export async function updateRegularization(
  ctx: AttendanceCtx,
  id: string,
  data: UpdateRegularizationInput,
): Promise<void> {
  return withRoleTx(ctx, async (tx) => {
    if (!(await loadOwnPendingReg(tx, id))) throw new NotFoundError('Regularization not found');

    const sets = [];
    if (data.requested_status_name !== undefined) {
      sets.push(sql`requested_status_id = ${
        data.requested_status_name
          ? sql`(SELECT id FROM hr.attendance_statuses WHERE name = ${data.requested_status_name})`
          : sql`NULL`
      }`);
    }
    if (data.requested_in !== undefined) sets.push(sql`requested_in = ${data.requested_in}`);
    if (data.requested_out !== undefined) sets.push(sql`requested_out = ${data.requested_out}`);
    if (data.reason !== undefined) sets.push(sql`reason = ${data.reason}`);
    if (sets.length === 0) return;

    const res = (await tx.execute(sql`
      UPDATE hr.attendance_regularizations SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND status = 'pending' AND NOT is_deleted
      RETURNING id::text
    `)) as unknown as Row[];
    if (res.length === 0) throw new NotFoundError('Regularization not found');
  });
}

export async function cancelRegularization(ctx: AttendanceCtx, id: string): Promise<void> {
  return withRoleTx(ctx, async (tx) => {
    if (!(await loadOwnPendingReg(tx, id))) throw new NotFoundError('Regularization not found');
    // acted_at/approver_id stay null — nobody decided this; the requester withdrew
    // it. Leaving 'pending' also releases the one-open-per-date unique index, so
    // the employee can file a corrected request for the same day.
    const res = (await tx.execute(sql`
      UPDATE hr.attendance_regularizations
      SET status = 'cancelled'
      WHERE id = ${id} AND status = 'pending' AND NOT is_deleted
      RETURNING id::text
    `)) as unknown as Row[];
    if (res.length === 0) throw new NotFoundError('Regularization not found');
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

/**
 * Structural rule: nobody acts on their OWN request -- not a subtree manager,
 * not an hr_admin override, not a tenant/super admin.
 *
 * hr.can_approve already returns FALSE when approver = requester, but the
 * override path deliberately short-circuits that call (`!isOverride && ...`),
 * so an hr_admin could approve their own regularization or clear their own
 * failed face review. Burying the rule inside a function that is sometimes
 * skipped is exactly how that was missed -- so it lives here, at the call site,
 * where it is unconditional and visible.
 *
 * Leave enforces the same rule by calling canApproveLeave unconditionally
 * (leave.repository.ts); this is the attendance-side equivalent.
 */
function assertNotSelfApproval(actorId: string, requesterId: string): void {
  if (actorId === requesterId) {
    throw new ForbiddenError('You cannot approve or reject your own request');
  }
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
  // false when earlier levels of the chain have signed off but more remain, so
  // the caller knows the requester has NOT been told "approved" yet.
  final: boolean;
  next_approver_id: string | null;
}

interface RegPendingLevel {
  id: string;
  level: number;
  approver_id: string;
}

// The lowest level still awaiting a decision — the one an approval acts on.
async function currentPendingRegLevel(tx: DrizzleTx, regId: string): Promise<RegPendingLevel | null> {
  const rows = (await tx.execute(sql`
    SELECT id::text, level, approver_id::text
    FROM hr.attendance_regularization_approvals
    WHERE regularization_id = ${regId} AND action = 'pending'
    ORDER BY level ASC
    LIMIT 1
  `)) as unknown as RegPendingLevel[];
  return rows[0] ?? null;
}

async function furtherPendingRegLevel(tx: DrizzleTx, regId: string, level: number): Promise<RegPendingLevel | null> {
  const rows = (await tx.execute(sql`
    SELECT id::text, level, approver_id::text
    FROM hr.attendance_regularization_approvals
    WHERE regularization_id = ${regId} AND action = 'pending' AND level > ${level}
    ORDER BY level ASC
    LIMIT 1
  `)) as unknown as RegPendingLevel[];
  return rows[0] ?? null;
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
    assertNotSelfApproval(ctx.user_id, reg.user_id);

    // Multi-level sign-off, same shape as leave: act on the lowest pending
    // level, and only finalize once no level is left.
    const pending = await currentPendingRegLevel(tx, id);

    // Requests created before approval levels existed have no rows at all —
    // treat them as single-level so an in-flight queue does not become
    // unactionable at deploy time.
    if (pending) {
      const isAssignedApprover = pending.approver_id === ctx.user_id;
      // hr_admin / org_admin / tenant_admin act at any level without holding
      // one; canApprove (hr.can_approve) is what grants that, and it also
      // covers the manager chain for the assigned approver.
      if (!isAssignedApprover && !isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, reg.user_id))) {
        throw new ForbiddenError('You are not the approver for this level');
      }
      const actComment = isAssignedApprover
        ? comment
        : `[override by ${ctx.user_id}] ${comment ?? ''}`.trim();
      await tx.execute(sql`
        UPDATE hr.attendance_regularization_approvals
        SET action = 'approved', acted_at = CLOCK_TIMESTAMP(), comment = ${actComment}
        WHERE id = ${pending.id}
      `);

      // More levels to go: the request stays pending and the day is untouched.
      const next = await furtherPendingRegLevel(tx, id, pending.level);
      if (next) {
        return {
          regularization_id: id,
          requester_id: reg.user_id,
          org_id: reg.org_id,
          work_date: reg.work_date,
          day_flipped: false,
          final: false,
          next_approver_id: next.approver_id,
        };
      }
    } else if (!isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, reg.user_id))) {
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
      // A regularization is a single corrected span, not a split-shift day, so
      // worked stays (out - in). It also CLEARS all three review flags: the
      // approved override supersedes the punches that raised them, and leaving
      // them set would flag a day an approver just fixed. Note this includes
      // has_pending_face_review — an approver correcting the day has implicitly
      // decided it, and the underlying event keeps its own 'pending' status in
      // the face-review queue for a separate decision.
      await tx.execute(sql`
        INSERT INTO hr.attendance_days
          (user_id, org_id, work_date, first_in, last_out, worked_minutes, status_id,
           has_off_window_punch, has_open_session, has_pending_face_review, resolved_at, resolution_source)
        VALUES
          (${reg.user_id}, ${ctx.org_id}, ${reg.work_date}::date, ${reg.requested_in}, ${reg.requested_out}, ${worked},
           (SELECT id FROM hr.attendance_statuses WHERE tenant_id = ${ctx.tenant_id} AND name = ${reg.requested_status_name}),
           FALSE, FALSE, FALSE, CLOCK_TIMESTAMP(), 'regularization')
        ON CONFLICT (user_id, work_date) DO UPDATE SET
          first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out, worked_minutes = EXCLUDED.worked_minutes,
          status_id = EXCLUDED.status_id, has_off_window_punch = FALSE, has_open_session = FALSE,
          has_pending_face_review = FALSE, resolved_at = CLOCK_TIMESTAMP(),
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
      final: true,
      next_approver_id: null,
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
    assertNotSelfApproval(ctx.user_id, reg.user_id);

    // A rejection at ANY level ends the request — the remaining levels never see
    // it, exactly as leave behaves. Same authority rule as approve.
    const pending = await currentPendingRegLevel(tx, id);
    if (pending) {
      const isAssignedApprover = pending.approver_id === ctx.user_id;
      if (!isAssignedApprover && !isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, reg.user_id))) {
        throw new ForbiddenError('You are not the approver for this level');
      }
      const actComment = isAssignedApprover
        ? comment
        : `[override by ${ctx.user_id}] ${comment}`.trim();
      await tx.execute(sql`
        UPDATE hr.attendance_regularization_approvals
        SET action = 'rejected', acted_at = CLOCK_TIMESTAMP(), comment = ${actComment}
        WHERE id = ${pending.id}
      `);
    } else if (!isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, reg.user_id))) {
      throw new ForbiddenError('You are not authorized to act on this regularization');
    }

    await tx.execute(sql`
      UPDATE hr.attendance_regularizations
      SET status = 'rejected', approver_id = ${ctx.user_id}, acted_at = CLOCK_TIMESTAMP(), approver_comment = ${comment}
      WHERE id = ${id}
    `);
    return {
      regularization_id: id,
      requester_id: reg.user_id,
      org_id: reg.org_id,
      work_date: reg.work_date,
      day_flipped: false,
      final: true,
      next_approver_id: null,
    };
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

/** The user's stored avatar (iam.users.photo_key) — the reference photo source. */
async function loadAvatarKey(tx: DrizzleTx, userId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT photo_key FROM iam.users WHERE id = ${userId} AND NOT is_deleted
  `)) as unknown as Array<{ photo_key: string | null }>;
  return rows[0]?.photo_key ?? null;
}

export async function enrollFace(ctx: AttendanceCtx, userId: string): Promise<FaceEnrollResult> {
  // 1. Confirm the target is an employee of this org, and pull the avatar key
  //    that will serve as the CompreFace reference. The photo is uploaded first
  //    via identity-service, so the avatar and the biometric reference are the
  //    same image — no second copy is stored here.
  const refKey = await serviceTxWithContext(ctx, async (tx) => {
    await assertEmployeeInOrg(tx, ctx.org_id, userId);
    return loadAvatarKey(tx, userId);
  });
  if (!refKey) {
    throw new BadRequestError('Upload a profile photo before enrolling for face attendance', {
      code: 'FACE_NO_PHOTO',
    });
  }

  const photoBuf = await getPhotoStorage().get(refKey);
  if (!photoBuf) {
    throw new BadRequestError('Stored profile photo could not be read; re-upload it', {
      code: 'FACE_NO_PHOTO',
    });
  }

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

  // 3. Point the profile at the avatar key + record consent/enrolment time.
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

// Self-service enrollment context: whether the caller has a photo, is enrolled,
// whether the org enforces face matching, and — for the cooldown gate — when they
// may next change their reference photo. Cooldown is measured from the last
// successful enrolment (face_enrolled_at), which the avatar upload never touches,
// so a pre-upload check and the post-upload enroll re-check always agree.
export interface SelfFaceContext {
  user_id: string;
  has_photo: boolean;
  enrolled: boolean;
  require_face_match: boolean;
  cooldown_days: number;
  can_change_photo: boolean;
  next_change_allowed_at: string | null;
}

export async function getSelfFaceContext(ctx: AttendanceCtx): Promise<SelfFaceContext> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT u.photo_key,
             ep.face_subject_id,
             ep.face_enrolled_at,
             COALESCE(r.require_face_match, FALSE)        AS require_face_match,
             COALESCE(r.photo_change_cooldown_days, 30)   AS cooldown_days,
             (ep.face_enrolled_at + make_interval(days => COALESCE(r.photo_change_cooldown_days, 30)))::text
                                                          AS next_change_allowed_at,
             (ep.face_enrolled_at IS NULL
               OR NOW() >= ep.face_enrolled_at + make_interval(days => COALESCE(r.photo_change_cooldown_days, 30)))
                                                          AS can_change_photo
      FROM iam.users u
      LEFT JOIN hr.employee_profiles ep ON ep.user_id = u.id AND ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted
      LEFT JOIN hr.attendance_rules r  ON r.org_id = ${ctx.org_id} AND r.is_active AND NOT r.is_deleted
      WHERE u.id = ${ctx.user_id}
    `)) as unknown as Array<{
      photo_key: string | null;
      face_subject_id: string | null;
      face_enrolled_at: string | null;
      require_face_match: boolean;
      cooldown_days: number;
      next_change_allowed_at: string | null;
      can_change_photo: boolean;
    }>;
    const row = rows[0];
    return {
      user_id: ctx.user_id,
      has_photo: !!row?.photo_key,
      enrolled: row?.face_subject_id != null,
      require_face_match: row?.require_face_match ?? false,
      cooldown_days: Number(row?.cooldown_days ?? 30),
      can_change_photo: row?.can_change_photo ?? true,
      next_change_allowed_at: row?.can_change_photo ? null : (row?.next_change_allowed_at ?? null),
    };
  });
}

/** Days remaining before `userId` may re-enroll, or 0 if allowed now. */
export async function enrollCooldownRemainingDays(ctx: AttendanceCtx, userId: string): Promise<number> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
               ep.face_enrolled_at + make_interval(days => COALESCE(r.photo_change_cooldown_days, 30)) - NOW()
             )) / 86400))::int AS remaining
      FROM hr.employee_profiles ep
      LEFT JOIN hr.attendance_rules r ON r.org_id = ${ctx.org_id} AND r.is_active AND NOT r.is_deleted
      WHERE ep.user_id = ${userId} AND ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted
        AND ep.face_enrolled_at IS NOT NULL
    `)) as unknown as Array<{ remaining: number }>;
    return rows[0]?.remaining ?? 0;
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
  // Most important of the three: face review exists to catch buddy-punching, so
  // clearing your own flagged punch would defeat the control outright.
  assertNotSelfApproval(ctx.user_id, evt.user_id);
  if (!isOverride && !(await canApprove(tx, ctx.org_id, ctx.user_id, evt.user_id))) {
    throw new ForbiddenError('You are not authorized to act on this face review');
  }
}

/**
 * Re-resolve the day an event belongs to, after its face_review_status changed.
 *
 * Both decisions need this, in opposite directions: rejecting drops the punch out
 * of the day entirely, and clearing lets a previously WITHHELD punch count for the
 * first time — pending minutes are excluded until someone clears them, so this is
 * the step that restores the employee's time.
 */
async function recomputeDayForEvent(
  tx: DrizzleTx,
  ctx: AttendanceCtx,
  evt: FaceEventForAction,
): Promise<string> {
  const org = await loadOrg(tx, ctx.org_id);
  const occurred = new Date(evt.occurred_at);
  const localToday = localDateOf(occurred, org.timezone);
  const shift = await currentShift(tx, ctx.org_id, evt.user_id, localToday);
  const shiftStartMin = shift ? parseTimeToMinutes(shift.start_time) : 0;
  const isNight = shift?.is_night_shift ?? false;
  const workDate = workDateOf(occurred, org.timezone, isNight, shiftStartMin);

  const offRows = (await tx.execute(sql`
    SELECT weekly_off_pattern AS p FROM hr.employee_profiles
    WHERE user_id = ${evt.user_id} AND org_id = ${ctx.org_id} AND NOT is_deleted
  `)) as unknown as Array<{ p: number[] }>;

  const emp: DayEmployee = {
    user_id: evt.user_id,
    org_id: ctx.org_id,
    tenant_id: ctx.tenant_id,
    timezone: org.timezone,
    weekly_off_pattern: offRows[0]?.p ?? [0, 6],
  };
  const resolution = await computeDayResolution(tx, emp, workDate, orgThresholdsOf(await getCachedRules(ctx.org_id)));
  await upsertResolvedDay(tx, emp, workDate, resolution, { overwrite: true });
  return workDate;
}

export async function clearFaceReview(ctx: AttendanceCtx, eventId: string, isOverride: boolean): Promise<FaceReviewDecision> {
  return serviceTxWithContext(ctx, async (tx) => {
    const evt = await loadFaceEventForAction(tx, eventId);
    await assertCanActOnFaceReview(tx, ctx, evt!, isOverride);

    // Confirm the punch, then recompute — a cleared punch counts, and its minutes
    // were being withheld until this moment.
    await tx.execute(sql`
      UPDATE hr.attendance_events SET face_review_status = 'cleared' WHERE id = ${eventId}
    `);
    const workDate = await recomputeDayForEvent(tx, ctx, evt!);

    return { event_id: eventId, user_id: evt!.user_id, work_date: workDate, day_recomputed: true };
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
    const workDate = await recomputeDayForEvent(tx, ctx, evt!);

    return { event_id: eventId, user_id: evt!.user_id, work_date: workDate, day_recomputed: true };
  });
}
