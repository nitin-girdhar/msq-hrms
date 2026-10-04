// ─────────────────────────────────────────────────────────────────────────────
// Roster planner (schema 1.66.0).
//
// HR plans who works which shift. Everything runs in the SERVICE transaction behind
// hr.attendance.roster.manage: the planner reads and rewrites other people's shift
// assignments, which no app_user policy would allow, so every query is fenced to the
// caller's org in code. The assignment edits are computed by lib/attendance/planner.ts
// (pure, unit-tested) and applied here.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withServiceTx, type DrizzleTx, type RoleTxContext } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import type { ShiftTimes } from '../../../lib/attendance/swap.js';
import { addDays, eachDate, mondayOf, overlapsOnShift, planRange, rangeFor, restProblems, shiftOnAfter, type Op, type Window } from '../../../lib/attendance/planner.js';
import type { ApplyShiftsInput, PlannerWeekQuery, ReallocateShiftsInput } from '@hr/validation';

export type PlannerCtx = RoleTxContext;

const todayIso = () => new Date().toISOString().slice(0, 10);

async function withContext<T>(ctx: PlannerCtx, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return withServiceTx(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`);
    return fn(tx);
  });
}

export interface PlannerShift {
  id: string;
  name: string;
  start: string;
  end: string;
  is_night: boolean;
  is_split: boolean;
  required: number | null;
}
export interface PlannerDay {
  date: string;
  kind: 'shift' | 'off' | 'holiday' | 'leave' | 'none';
  shift_id: string | null;
}
export interface PlannerPerson {
  user_id: string;
  full_name: string;
  employee_code: string | null;
  designation_name: string | null;
  department_name: string | null;
  days: PlannerDay[];
}
export interface PlannerWeek {
  view: 'day' | 'week' | 'month';
  /** The first and last date of the view (a week, a day or a calendar month). */
  week_start: string;
  week_end: string;
  published: { published_at: string; published_by_name: string | null; note: string | null } | null;
  changes_since_publish: number;
  shifts: PlannerShift[];
  /** assigned[shiftId][dayIndex]: people on that shift that day (weekly offs, holidays and leave excluded). */
  assigned: Record<string, number[]>;
  headcount: number;
  people: PlannerPerson[];
}

export async function getWeek(ctx: PlannerCtx, query: PlannerWeekQuery): Promise<PlannerWeek> {
  return withContext(ctx, async (tx) => {
    const view = query.view ?? 'week';
    const { start, end } = rangeFor(view, query.from ?? todayIso());
    const dates = eachDate(start, end);

    const shifts = (await tx.execute(sql`
      SELECT s.id::text AS id, s.name, s.start_time::text AS start, s.end_time::text AS "end",
             s.is_night_shift AS is_night, s.is_split, r.required_headcount AS required
      FROM hr.shifts s
      LEFT JOIN hr.shift_requirements r ON r.shift_id = s.id AND r.org_id = s.org_id AND NOT r.is_deleted
      WHERE s.org_id = ${ctx.org_id} AND s.is_active AND NOT s.is_deleted
      ORDER BY s.start_time, s.name
    `)) as unknown as PlannerShift[];
    const shortened = shifts.map((s) => ({ ...s, start: s.start.slice(0, 5), end: s.end.slice(0, 5) }));

    const q = query.q ? `%${query.q.replace(/[%_]/g, (c) => `\\${c}`)}%` : null;
    const people = (await tx.execute(sql`
      SELECT u.id::text AS user_id, u.full_name, ep.employee_code, ds.name AS designation_name, d.name AS department_name,
             ep.weekly_off_pattern AS wo
      FROM hr.employee_profiles ep
      JOIN iam.users u ON u.id = ep.user_id
      LEFT JOIN hr.designations ds ON ds.id = ep.designation_id
      LEFT JOIN iam.departments d ON d.id = ep.department_id
      WHERE ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted AND ep.is_active AND u.is_active
        ${query.department_id ? sql`AND ep.department_id = ${query.department_id}` : sql``}
        ${q ? sql`AND (u.full_name ILIKE ${q} OR u.email ILIKE ${q} OR ep.employee_code ILIKE ${q})` : sql``}
      ORDER BY u.full_name
      LIMIT 300
    `)) as unknown as Array<Omit<PlannerPerson, 'days'> & { wo: number[] | null }>;

    // Publishing is a per-week act; the day and month views carry no publication state.
    const pub = view !== 'week' ? [] : (await tx.execute(sql`
      SELECT p.published_at::text AS published_at, u.full_name AS published_by_name, p.note
      FROM hr.roster_publications p LEFT JOIN iam.users u ON u.id = p.published_by
      WHERE p.org_id = ${ctx.org_id} AND p.week_start = ${start}::date AND NOT p.is_deleted
    `)) as unknown as Array<{ published_at: string; published_by_name: string | null; note: string | null }>;

    const assigned: Record<string, number[]> = Object.fromEntries(shortened.map((s) => [s.id, Array(dates.length).fill(0) as number[]]));
    if (people.length === 0) {
      return { view, week_start: start, week_end: end, published: pub[0] ?? null, changes_since_publish: 0, shifts: shortened, assigned, headcount: 0, people: [] };
    }

    const idList = sql.join(people.map((p) => sql`${p.user_id}::uuid`), sql`, `);
    const assigns = (await tx.execute(sql`
      SELECT a.user_id::text AS user_id, a.shift_id::text AS shift_id, a.effective_from::text AS "from", a.effective_to::text AS "to"
      FROM hr.shift_assignments a
      WHERE a.org_id = ${ctx.org_id} AND NOT a.is_deleted AND a.is_active AND a.user_id IN (${idList})
        AND a.effective_from <= ${end}::date AND (a.effective_to IS NULL OR a.effective_to >= ${start}::date)
    `)) as unknown as Array<{ user_id: string; shift_id: string; from: string; to: string | null }>;
    const holidays = new Set(
      ((await tx.execute(sql`
        SELECT holiday_date::text AS d FROM hr.holidays
        WHERE org_id = ${ctx.org_id} AND is_active AND NOT is_deleted AND NOT is_optional
          AND holiday_date BETWEEN ${start}::date AND ${end}::date
      `)) as unknown as Array<{ d: string }>).map((r) => r.d),
    );
    const leaves = (await tx.execute(sql`
      SELECT lr.user_id::text AS user_id, lr.start_date::text AS s, lr.end_date::text AS e
      FROM hr.leave_requests lr JOIN hr.leave_request_statuses st ON st.id = lr.status_id
      WHERE lr.org_id = ${ctx.org_id} AND NOT lr.is_deleted AND st.name = 'approved' AND lr.user_id IN (${idList})
        AND lr.start_date <= ${end}::date AND lr.end_date >= ${start}::date
    `)) as unknown as Array<{ user_id: string; s: string; e: string }>;

    const out: PlannerPerson[] = people.map((p) => {
      const days = dates.map((d, i): PlannerDay => {
        if (leaves.some((l) => l.user_id === p.user_id && l.s <= d && l.e >= d)) return { date: d, kind: 'leave', shift_id: null };
        if (holidays.has(d)) return { date: d, kind: 'holiday', shift_id: null };
        if ((p.wo ?? [0, 6]).includes(new Date(`${d}T00:00:00Z`).getUTCDay())) return { date: d, kind: 'off', shift_id: null };
        const a = assigns.find((x) => x.user_id === p.user_id && x.from <= d && (x.to === null || x.to >= d));
        if (!a) return { date: d, kind: 'none', shift_id: null };
        const bucket = assigned[a.shift_id];
        if (bucket) bucket[i] = (bucket[i] ?? 0) + 1;
        return { date: d, kind: 'shift', shift_id: a.shift_id };
      });
      return { user_id: p.user_id, full_name: p.full_name, employee_code: p.employee_code, designation_name: p.designation_name, department_name: p.department_name, days };
    });

    // How many assignment rows touching this week were created, changed or removed after it was published.
    let changes = 0;
    if (pub[0]) {
      const c = (await tx.execute(sql`
        SELECT count(*)::int AS n FROM hr.shift_assignments a
        WHERE a.org_id = ${ctx.org_id} AND a.updated_at > ${pub[0].published_at}::timestamptz
          AND a.effective_from <= ${end}::date AND (a.effective_to IS NULL OR a.effective_to >= ${start}::date)
      `)) as unknown as Array<{ n: number }>;
      changes = c[0]?.n ?? 0;
    }
    return { view, week_start: start, week_end: end, published: pub[0] ?? null, changes_since_publish: changes, shifts: shortened, assigned, headcount: people.length, people: out };
  });
}

// ── Editing ──────────────────────────────────────────────────────────────────
export interface ApplyResult {
  applied: number;
  skipped: Array<{ user_id: string; full_name: string; reason: string }>;
  /** user ids whose assignments changed, for the audit log. */
  changed: string[];
}

interface ShiftCatalog {
  times: Map<string, ShiftTimes>;
}

async function loadCatalog(tx: DrizzleTx, orgId: string): Promise<ShiftCatalog> {
  const rows = (await tx.execute(sql`
    SELECT id::text AS id, start_time::text AS start, end_time::text AS "end", is_night_shift AS "isNight"
    FROM hr.shifts WHERE org_id = ${orgId} AND NOT is_deleted
  `)) as unknown as ShiftTimes[];
  return { times: new Map(rows.map((r) => [r.id, r])) };
}

async function activeShift(tx: DrizzleTx, orgId: string, shiftId: string): Promise<void> {
  const rows = (await tx.execute(sql`SELECT 1 FROM hr.shifts WHERE id = ${shiftId} AND org_id = ${orgId} AND is_active AND NOT is_deleted`)) as unknown as unknown[];
  if (rows.length === 0) throw new NotFoundError('Shift not found');
}

async function windowsOf(tx: DrizzleTx, orgId: string, userId: string, lo: string, hi: string): Promise<Window[]> {
  return (await tx.execute(sql`
    SELECT id::text AS id, shift_id::text AS "shiftId", effective_from::text AS "from", effective_to::text AS "to"
    FROM hr.shift_assignments
    WHERE user_id = ${userId} AND org_id = ${orgId} AND NOT is_deleted AND is_active
      AND effective_from <= ${hi}::date AND (effective_to IS NULL OR effective_to >= ${lo}::date)
    FOR UPDATE
  `)) as unknown as Window[];
}

/**
 * Make `shiftId` (or no shift) this person's shift for [from, to]: rest-checked first, then the carve
 * applied. Returns a reason when the 11-hour rule would be broken (nothing is written), else null.
 */
async function applyForPerson(
  tx: DrizzleTx, ctx: PlannerCtx, catalog: ShiftCatalog, personId: string, from: string, to: string, shiftId: string | null,
): Promise<{ changed: boolean; skippedReason: string | null }> {
  const windows = await windowsOf(tx, ctx.org_id, personId, addDays(from, -2), addDays(to, 2));
  const ops: Op[] = planRange(windows, from, to, shiftId);
  if (ops.length === 0) return { changed: false, skippedReason: null };

  if (shiftId) {
    const problems = restProblems((d) => {
      const id = shiftOnAfter(windows, ops, d);
      return id ? catalog.times.get(id) ?? null : null;
    }, from, to);
    if (problems.length > 0) return { changed: false, skippedReason: `${problems[0]!.date}: ${problems[0]!.reason}` };
  }
  for (const op of ops) {
    if (op.kind === 'shrink') {
      await tx.execute(sql`UPDATE hr.shift_assignments SET effective_to = ${op.newTo}::date WHERE id = ${op.id}`);
    } else if (op.kind === 'delete') {
      await tx.execute(sql`
        UPDATE hr.shift_assignments SET is_active = FALSE, is_deleted = TRUE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id}
        WHERE id = ${op.id}`);
    } else {
      await tx.execute(sql`
        INSERT INTO hr.shift_assignments (user_id, org_id, shift_id, effective_from, effective_to, created_by)
        VALUES (${personId}, ${ctx.org_id}, ${op.shiftId}, ${op.from}::date, ${op.to}::date, ${ctx.user_id})`);
    }
  }
  return { changed: true, skippedReason: null };
}

async function activePeople(tx: DrizzleTx, orgId: string, ids: string[] | null): Promise<Array<{ user_id: string; full_name: string }>> {
  const only = ids ? sql`AND u.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  return (await tx.execute(sql`
    SELECT u.id::text AS user_id, u.full_name FROM hr.employee_profiles ep JOIN iam.users u ON u.id = ep.user_id
    WHERE ep.org_id = ${orgId} AND NOT ep.is_deleted AND ep.is_active AND u.is_active ${only}
  `)) as unknown as Array<{ user_id: string; full_name: string }>;
}

export async function applyShifts(ctx: PlannerCtx, input: ApplyShiftsInput): Promise<ApplyResult> {
  if (input.from < todayIso()) {
    throw new ConflictError('Past days are already resolved into attendance. Plan from today onwards.');
  }
  return withContext(ctx, async (tx) => {
    if (input.shift_id) await activeShift(tx, ctx.org_id, input.shift_id);
    const catalog = await loadCatalog(tx, ctx.org_id);
    const people = await activePeople(tx, ctx.org_id, input.user_ids);
    if (people.length === 0) throw new NotFoundError('None of those people were found');

    const result: ApplyResult = { applied: 0, skipped: [], changed: [] };
    for (const person of people) {
      const r = await applyForPerson(tx, ctx, catalog, person.user_id, input.from, input.to, input.shift_id);
      if (r.skippedReason) result.skipped.push({ user_id: person.user_id, full_name: person.full_name, reason: r.skippedReason });
      else if (r.changed) { result.applied += 1; result.changed.push(person.user_id); }
    }
    // Anyone asked for but not found in this org is reported, never silently dropped.
    const found = new Set(people.map((p) => p.user_id));
    for (const id of input.user_ids) if (!found.has(id)) result.skipped.push({ user_id: id, full_name: 'Unknown person', reason: 'Not an active employee of this branch' });
    return result;
  });
}

/** Move everyone (or the listed people) from one shift to another over a range; only the days they were on it change. */
export async function reallocate(ctx: PlannerCtx, input: ReallocateShiftsInput): Promise<ApplyResult> {
  if (input.from < todayIso()) {
    throw new ConflictError('Past days are already resolved into attendance. Plan from today onwards.');
  }
  return withContext(ctx, async (tx) => {
    await activeShift(tx, ctx.org_id, input.from_shift_id);
    await activeShift(tx, ctx.org_id, input.to_shift_id);
    const catalog = await loadCatalog(tx, ctx.org_id);
    const people = await activePeople(tx, ctx.org_id, input.user_ids ?? null);
    const result: ApplyResult = { applied: 0, skipped: [], changed: [] };

    for (const person of people) {
      const windows = await windowsOf(tx, ctx.org_id, person.user_id, input.from, input.to);
      const spans = overlapsOnShift(windows, input.from_shift_id, input.from, input.to);
      if (spans.length === 0) continue;
      let touched = false;
      for (const span of spans) {
        const r = await applyForPerson(tx, ctx, catalog, person.user_id, span.from, span.to, input.to_shift_id);
        if (r.skippedReason) { result.skipped.push({ user_id: person.user_id, full_name: person.full_name, reason: r.skippedReason }); break; }
        if (r.changed) touched = true;
      }
      if (touched) { result.applied += 1; result.changed.push(person.user_id); }
    }
    return result;
  });
}

export async function setRequirement(ctx: PlannerCtx, shiftId: string, headcount: number): Promise<void> {
  await withContext(ctx, async (tx) => {
    const s = (await tx.execute(sql`SELECT 1 FROM hr.shifts WHERE id = ${shiftId} AND org_id = ${ctx.org_id} AND NOT is_deleted`)) as unknown as unknown[];
    if (s.length === 0) throw new NotFoundError('Shift not found');
    const upd = (await tx.execute(sql`
      UPDATE hr.shift_requirements SET required_headcount = ${headcount}
      WHERE shift_id = ${shiftId} AND org_id = ${ctx.org_id} AND NOT is_deleted RETURNING 1`)) as unknown as unknown[];
    if (upd.length === 0) {
      await tx.execute(sql`INSERT INTO hr.shift_requirements (org_id, shift_id, required_headcount, created_by) VALUES (${ctx.org_id}, ${shiftId}, ${headcount}, ${ctx.user_id})`);
    }
  });
}

export async function publishWeek(ctx: PlannerCtx, weekStart: string, note: string | null): Promise<{ published_at: string }> {
  if (mondayOf(weekStart) !== weekStart) throw new BadRequestError('A roster week starts on a Monday');
  return withContext(ctx, async (tx) => {
    const upd = (await tx.execute(sql`
      UPDATE hr.roster_publications SET published_by = ${ctx.user_id}, published_at = CLOCK_TIMESTAMP(), note = ${note}
      WHERE org_id = ${ctx.org_id} AND week_start = ${weekStart}::date AND NOT is_deleted
      RETURNING published_at::text AS published_at`)) as unknown as Array<{ published_at: string }>;
    if (upd[0]) return upd[0];
    const ins = (await tx.execute(sql`
      INSERT INTO hr.roster_publications (org_id, week_start, published_by, note, created_by)
      VALUES (${ctx.org_id}, ${weekStart}::date, ${ctx.user_id}, ${note}, ${ctx.user_id})
      RETURNING published_at::text AS published_at`)) as unknown as Array<{ published_at: string }>;
    return ins[0]!;
  });
}
