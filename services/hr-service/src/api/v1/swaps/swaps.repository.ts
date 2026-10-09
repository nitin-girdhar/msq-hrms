// ─────────────────────────────────────────────────────────────────────────────
// Team roster + peer shift swaps (schema 1.61.0).
//
// Everything runs in the SERVICE transaction: a swap is between two people and an
// approver, none of whom may read the other's rows under RLS, and approval rewrites
// BOTH people's shift assignments. Authorization is therefore enforced here in code
// -- participant / assigned approver / override, org fence on every query -- and the
// rules themselves live in lib/attendance/swap.ts (pure, unit-tested).
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withServiceTx, pgErrorCode, type DrizzleTx, type RoleTxContext } from '@platform/db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import { resolveApprovers } from '../../../lib/leave/resolve-approvers.js';
import { addDaysIso } from '../../../lib/leave/comp-off.js';
import {
  checkSwap,
  MIN_REST_HOURS,
  planSplit,
  type AssignmentWindow,
  type DayContext,
  type ShiftTimes,
} from '../../../lib/attendance/swap.js';
import type { CreateShiftSwapInput } from '@hr/validation';

export type SwapCtx = RoleTxContext;

const todayIso = () => new Date().toISOString().slice(0, 10);

async function withContext<T>(ctx: SwapCtx, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return withServiceTx(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`);
    return fn(tx);
  });
}

// ── Day facts ────────────────────────────────────────────────────────────────
interface AssignmentRow extends AssignmentWindow {
  start: string;
  end: string;
  isNight: boolean;
  minRestHours: number | null;
  shiftName: string;
}

/** The minimum-rest policy in force for the org (org row wins whole over the tenant default); 0 = rule off. */
async function policyMinRest(tx: DrizzleTx, tenantId: string, orgId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT min_rest_hours FROM hr.attendance_rules
    WHERE tenant_id = ${tenantId} AND NOT is_deleted AND (org_id = ${orgId} OR org_id IS NULL)
    ORDER BY (org_id IS NULL) LIMIT 1
  `)) as unknown as Array<{ min_rest_hours: number }>;
  return rows[0]?.min_rest_hours ?? MIN_REST_HOURS;
}

async function assignmentOn(tx: DrizzleTx, orgId: string, userId: string, date: string): Promise<AssignmentRow | null> {
  const rows = (await tx.execute(sql`
    SELECT a.id::text AS id, a.shift_id::text AS "shiftId", a.effective_from::text AS "from", a.effective_to::text AS "to",
           s.start_time::text AS start, s.end_time::text AS "end", s.is_night_shift AS "isNight",
           s.min_rest_hours AS "minRestHours", s.name AS "shiftName"
    FROM hr.shift_assignments a
    JOIN hr.shifts s ON s.id = a.shift_id
    WHERE a.user_id = ${userId} AND a.org_id = ${orgId} AND NOT a.is_deleted AND a.is_active
      AND a.effective_from <= ${date}::date AND (a.effective_to IS NULL OR a.effective_to >= ${date}::date)
    LIMIT 1
  `)) as unknown as AssignmentRow[];
  return rows[0] ?? null;
}

const asShift = (a: AssignmentRow | null): ShiftTimes | null =>
  a ? { id: a.shiftId, start: a.start, end: a.end, isNight: a.isNight, minRestHours: a.minRestHours } : null;

async function dayContext(
  tx: DrizzleTx,
  orgId: string,
  userId: string,
  date: string,
): Promise<{ ctx: DayContext; assignment: AssignmentRow | null }> {
  const assignment = await assignmentOn(tx, orgId, userId, date);
  const prev = await assignmentOn(tx, orgId, userId, addDaysIso(date, -1));
  const next = await assignmentOn(tx, orgId, userId, addDaysIso(date, 1));
  const prof = (await tx.execute(sql`
    SELECT weekly_off_pattern AS p FROM hr.employee_profiles WHERE user_id = ${userId} AND org_id = ${orgId} AND NOT is_deleted
  `)) as unknown as Array<{ p: number[] | null }>;
  const weeklyOff = prof[0]?.p ?? [0, 6];
  const hol = (await tx.execute(sql`
    SELECT 1 FROM hr.holidays WHERE org_id = ${orgId} AND holiday_date = ${date}::date AND is_active AND NOT is_deleted AND NOT is_optional LIMIT 1
  `)) as unknown as unknown[];
  const leave = (await tx.execute(sql`
    SELECT 1 FROM hr.leave_requests lr JOIN hr.leave_request_statuses s ON s.id = lr.status_id
    WHERE lr.user_id = ${userId} AND lr.org_id = ${orgId} AND NOT lr.is_deleted AND s.name = 'approved'
      AND lr.start_date <= ${date}::date AND lr.end_date >= ${date}::date LIMIT 1
  `)) as unknown as unknown[];
  return {
    assignment,
    ctx: {
      shift: asShift(assignment),
      isWeeklyOff: weeklyOff.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
      isHoliday: hol.length > 0,
      onLeave: leave.length > 0,
      prev: asShift(prev),
      next: asShift(next),
    },
  };
}

// ── Roster ───────────────────────────────────────────────────────────────────
export interface RosterDay {
  date: string;
  kind: 'shift' | 'off' | 'holiday' | 'leave' | 'none';
  shift_name: string | null;
  start: string | null;
  end: string | null;
}
export interface RosterSupervisor {
  user_id: string;
  full_name: string;
  designation_name: string | null;
}
export interface RosterPerson {
  user_id: string;
  full_name: string;
  is_me: boolean;
  days: RosterDay[];
}

function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDaysIso(iso, dow === 0 ? -6 : 1 - dow);
}

/** The week's roster for the caller's team (or the whole branch for `seeAllOrg`). */
export async function getRoster(ctx: SwapCtx, from: string | undefined, seeAllOrg: boolean) {
  return withContext(ctx, async (tx) => {
    const start = mondayOf(from ?? todayIso());
    const end = addDaysIso(start, 6);
    const dates = Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));

    const scope = seeAllOrg
      ? sql``
      : sql`AND (u.id = ${ctx.user_id}
                 OR u.manager_id = ${ctx.user_id}
                 OR (u.manager_id IS NOT NULL AND u.manager_id = (SELECT manager_id FROM iam.users WHERE id = ${ctx.user_id})))`;
    const people = (await tx.execute(sql`
      SELECT u.id::text AS user_id, u.full_name, ep.weekly_off_pattern AS wo
      FROM hr.employee_profiles ep JOIN iam.users u ON u.id = ep.user_id
      WHERE ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted AND ep.is_active AND u.is_active ${scope}
      ORDER BY (u.id = ${ctx.user_id}) DESC, u.full_name
      LIMIT 200
    `)) as unknown as Array<{ user_id: string; full_name: string; wo: number[] | null }>;
    // The caller's own manager, for the "Supervisor" card. Name and title only.
    const sup = (await tx.execute(sql`
      SELECT m.id::text AS user_id, m.full_name, ds.name AS designation_name
      FROM iam.users u
      JOIN iam.users m ON m.id = u.manager_id AND m.is_active
      LEFT JOIN hr.employee_profiles mp ON mp.user_id = m.id AND NOT mp.is_deleted
      LEFT JOIN hr.designations ds ON ds.id = mp.designation_id
      WHERE u.id = ${ctx.user_id}
    `)) as unknown as RosterSupervisor[];
    const supervisor = sup[0] ?? null;
    const ids = people.map((p) => p.user_id);
    if (ids.length === 0) return { week_start: start, week_end: end, supervisor, people: [] as RosterPerson[] };

    const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    const assigns = (await tx.execute(sql`
      SELECT a.user_id::text AS user_id, a.effective_from::text AS "from", a.effective_to::text AS "to",
             s.name, s.start_time::text AS start, s.end_time::text AS "end"
      FROM hr.shift_assignments a JOIN hr.shifts s ON s.id = a.shift_id
      WHERE a.org_id = ${ctx.org_id} AND NOT a.is_deleted AND a.is_active AND a.user_id IN (${idList})
        AND a.effective_from <= ${end}::date AND (a.effective_to IS NULL OR a.effective_to >= ${start}::date)
    `)) as unknown as Array<{ user_id: string; from: string; to: string | null; name: string; start: string; end: string }>;
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

    const out: RosterPerson[] = people.map((p) => ({
      user_id: p.user_id,
      full_name: p.full_name,
      is_me: p.user_id === ctx.user_id,
      days: dates.map((d): RosterDay => {
        const blank = { date: d, shift_name: null, start: null, end: null };
        if (leaves.some((l) => l.user_id === p.user_id && l.s <= d && l.e >= d)) return { ...blank, kind: 'leave' };
        if (holidays.has(d)) return { ...blank, kind: 'holiday' };
        if ((p.wo ?? [0, 6]).includes(new Date(`${d}T00:00:00Z`).getUTCDay())) return { ...blank, kind: 'off' };
        const a = assigns.find((x) => x.user_id === p.user_id && x.from <= d && (x.to === null || x.to >= d));
        return a
          ? { date: d, kind: 'shift', shift_name: a.name, start: a.start.slice(0, 5), end: a.end.slice(0, 5) }
          : { ...blank, kind: 'none' };
      }),
    }));
    return { week_start: start, week_end: end, supervisor, people: out };
  });
}

// ── Swaps ────────────────────────────────────────────────────────────────────
export interface SwapView {
  id: string;
  swap_date: string;
  status: string;
  reason: string;
  requester_id: string;
  requester_name: string;
  peer_id: string;
  peer_name: string;
  requester_shift: string;
  peer_shift: string;
  manager_id: string | null;
  approver_comment: string | null;
  created_at: string;
}

const SWAP_SELECT = sql`
  w.id::text, w.swap_date::text, w.status, w.reason, w.requester_id::text, ru.full_name AS requester_name,
  w.peer_id::text, pu.full_name AS peer_name, rs.name AS requester_shift, ps.name AS peer_shift,
  w.manager_id::text, w.approver_comment, w.created_at::text
  FROM hr.shift_swap_requests w
  JOIN iam.users ru ON ru.id = w.requester_id
  JOIN iam.users pu ON pu.id = w.peer_id
  JOIN hr.shifts rs ON rs.id = w.requester_shift_id
  JOIN hr.shifts ps ON ps.id = w.peer_shift_id
`;

/** Swaps the caller is part of (requester, peer, or assigned approver), newest first. */
export async function listMine(ctx: SwapCtx): Promise<SwapView[]> {
  return withContext(
    ctx,
    async (tx) =>
      (await tx.execute(sql`
        SELECT ${SWAP_SELECT}
        WHERE w.org_id = ${ctx.org_id} AND NOT w.is_deleted
          AND ${ctx.user_id}::uuid IN (w.requester_id, w.peer_id, w.manager_id)
        ORDER BY w.created_at DESC LIMIT 100
      `)) as unknown as SwapView[],
  );
}

export async function createSwap(ctx: SwapCtx, data: CreateShiftSwapInput): Promise<{ id: string }> {
  return withContext(ctx, async (tx) => {
    if (data.peer_id === ctx.user_id) throw new BadRequestError('Pick a teammate to swap with');
    // The peer must be a colleague of the requester: same org, and sharing their manager.
    const peer = (await tx.execute(sql`
      SELECT u.id::text FROM iam.users u JOIN hr.employee_profiles ep ON ep.user_id = u.id
      WHERE u.id = ${data.peer_id} AND ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted AND ep.is_active AND u.is_active
        AND u.manager_id IS NOT NULL
        AND u.manager_id = (SELECT manager_id FROM iam.users WHERE id = ${ctx.user_id})
    `)) as unknown as unknown[];
    if (peer.length === 0) throw new NotFoundError('That teammate is not on your team');

    const mine = await dayContext(tx, ctx.org_id, ctx.user_id, data.swap_date);
    const theirs = await dayContext(tx, ctx.org_id, data.peer_id, data.swap_date);
    const verdict = checkSwap({
      today: todayIso(), swapDate: data.swap_date, requester: mine.ctx, peer: theirs.ctx,
      minRestHours: await policyMinRest(tx, ctx.tenant_id, ctx.org_id),
    });
    if (!verdict.ok) throw new BadRequestError(verdict.reason);

    // A person may be in only one open swap per day, as requester OR peer.
    const clash = (await tx.execute(sql`
      SELECT 1 FROM hr.shift_swap_requests
      WHERE swap_date = ${data.swap_date}::date AND NOT is_deleted AND status IN ('pending_peer','pending_manager')
        AND (requester_id IN (${ctx.user_id}::uuid, ${data.peer_id}::uuid) OR peer_id IN (${ctx.user_id}::uuid, ${data.peer_id}::uuid))
      LIMIT 1
    `)) as unknown as unknown[];
    if (clash.length > 0) throw new ConflictError('One of you already has an open swap for that day');

    const approvers = await resolveApprovers(tx, ctx.org_id, ctx.tenant_id, ctx.user_id, 1);
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.shift_swap_requests
          (org_id, requester_id, peer_id, swap_date, requester_shift_id, peer_shift_id, reason, manager_id, created_by)
        VALUES (${ctx.org_id}, ${ctx.user_id}, ${data.peer_id}, ${data.swap_date}, ${mine.ctx.shift!.id}, ${theirs.ctx.shift!.id},
                ${data.reason}, ${approvers[0]?.approverId ?? null}, ${ctx.user_id})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new ConflictError('One of you already has an open swap for that day');
      throw err;
    }
  });
}

async function loadSwap(tx: DrizzleTx, ctx: SwapCtx, id: string) {
  const rows = (await tx.execute(sql`
    SELECT id::text, requester_id::text, peer_id::text, manager_id::text, status, swap_date::text
    FROM hr.shift_swap_requests WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted FOR UPDATE
  `)) as unknown as Array<{ id: string; requester_id: string; peer_id: string; manager_id: string | null; status: string; swap_date: string }>;
  // Foreign org or unknown id: the same answer, so existence never leaks.
  if (!rows[0]) throw new NotFoundError('Shift swap not found');
  return rows[0];
}

/** The peer accepts (moves on to the approver) or declines. Only the named peer may answer. */
export async function respond(ctx: SwapCtx, id: string, accept: boolean) {
  return withContext(ctx, async (tx) => {
    const sw = await loadSwap(tx, ctx, id);
    if (sw.peer_id !== ctx.user_id) throw new ForbiddenError('Only the teammate you asked can answer this swap');
    if (sw.status !== 'pending_peer') throw new ConflictError(`Swap is already ${sw.status}`);
    // No approver could be resolved: nobody could ever decide it, so say so now.
    if (accept && !sw.manager_id) throw new BadRequestError('This swap has no approver; ask your administrator');
    await tx.execute(sql`
      UPDATE hr.shift_swap_requests
      SET status = ${accept ? 'pending_manager' : 'declined'}, peer_responded_at = CLOCK_TIMESTAMP()
      WHERE id = ${id}
    `);
    return { swap_id: id, requester_id: sw.requester_id, status: accept ? 'pending_manager' : 'declined' };
  });
}

export async function cancel(ctx: SwapCtx, id: string) {
  return withContext(ctx, async (tx) => {
    const sw = await loadSwap(tx, ctx, id);
    if (sw.requester_id !== ctx.user_id) throw new ForbiddenError('Only the person who asked can withdraw a swap');
    if (!['pending_peer', 'pending_manager'].includes(sw.status)) throw new ConflictError(`Swap is already ${sw.status}`);
    await tx.execute(sql`UPDATE hr.shift_swap_requests SET status = 'cancelled' WHERE id = ${id}`);
    return { swap_id: id };
  });
}

/** Swaps awaiting this approver's decision (the whole branch for an override holder). */
export async function listQueue(ctx: SwapCtx, seeAllOrg: boolean): Promise<SwapView[]> {
  return withContext(
    ctx,
    async (tx) =>
      (await tx.execute(sql`
        SELECT ${SWAP_SELECT}
        WHERE w.org_id = ${ctx.org_id} AND NOT w.is_deleted AND w.status = 'pending_manager'
          ${seeAllOrg ? sql`` : sql`AND w.manager_id = ${ctx.user_id}`}
        ORDER BY w.swap_date, w.created_at LIMIT 200
      `)) as unknown as SwapView[],
  );
}

export async function decide(ctx: SwapCtx, id: string, approve: boolean, comment: string | null, isOverride: boolean) {
  return withContext(ctx, async (tx) => {
    const sw = await loadSwap(tx, ctx, id);
    if (sw.status !== 'pending_manager') throw new ConflictError(`Swap is ${sw.status}, not awaiting a decision`);
    if (ctx.user_id === sw.requester_id || ctx.user_id === sw.peer_id) throw new ForbiddenError('You cannot decide your own swap');
    const isAssigned = sw.manager_id === ctx.user_id;
    if (!isAssigned && !isOverride) throw new ForbiddenError('You are not the approver for this swap');
    const note = isAssigned ? comment : `[override by ${ctx.user_id}] ${comment ?? ''}`.trim();

    if (!approve) {
      await tx.execute(sql`
        UPDATE hr.shift_swap_requests SET status = 'rejected', acted_by = ${ctx.user_id}, acted_at = CLOCK_TIMESTAMP(), approver_comment = ${note}
        WHERE id = ${id}`);
      return { swap_id: id, requester_id: sw.requester_id, peer_id: sw.peer_id, status: 'rejected' as const };
    }

    // Rosters may have moved since the peer agreed (a reassignment, an approved leave,
    // the day arriving): re-check against today's facts before touching anything.
    const a = await dayContext(tx, ctx.org_id, sw.requester_id, sw.swap_date);
    const b = await dayContext(tx, ctx.org_id, sw.peer_id, sw.swap_date);
    const verdict = checkSwap({
      today: todayIso(), swapDate: sw.swap_date, requester: a.ctx, peer: b.ctx,
      minRestHours: await policyMinRest(tx, ctx.tenant_id, ctx.org_id),
    });
    if (!verdict.ok) throw new ConflictError(`This swap can no longer go ahead: ${verdict.reason}`);

    // Carve the day out of each person's assignment and put the OTHER shift in it.
    // Shrink/remove first, then insert, so the no-overlap constraint holds throughout.
    const moves = [
      { who: sw.requester_id, mine: a.assignment!, incoming: b.assignment!.shiftId },
      { who: sw.peer_id, mine: b.assignment!, incoming: a.assignment!.shiftId },
    ];
    for (const { who, mine, incoming } of moves) {
      const plan = planSplit(mine, sw.swap_date, incoming);
      if (plan.existing.action === 'shrink') {
        await tx.execute(sql`UPDATE hr.shift_assignments SET effective_to = ${plan.existing.newTo}::date WHERE id = ${mine.id}`);
      } else {
        await tx.execute(sql`UPDATE hr.shift_assignments SET is_active = FALSE, is_deleted = TRUE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id} WHERE id = ${mine.id}`);
      }
      await tx.execute(sql`
        INSERT INTO hr.shift_assignments (user_id, org_id, shift_id, effective_from, effective_to, created_by)
        VALUES (${who}, ${ctx.org_id}, ${plan.swapDay.shiftId}, ${plan.swapDay.from}::date, ${plan.swapDay.to}::date, ${ctx.user_id})`);
      if (plan.continuation) {
        await tx.execute(sql`
          INSERT INTO hr.shift_assignments (user_id, org_id, shift_id, effective_from, effective_to, created_by)
          VALUES (${who}, ${ctx.org_id}, ${plan.continuation.shiftId}, ${plan.continuation.from}::date, ${plan.continuation.to}::date, ${ctx.user_id})`);
      }
    }
    await tx.execute(sql`
      UPDATE hr.shift_swap_requests SET status = 'approved', acted_by = ${ctx.user_id}, acted_at = CLOCK_TIMESTAMP(), approver_comment = ${note}
      WHERE id = ${id}`);
    return { swap_id: id, requester_id: sw.requester_id, peer_id: sw.peer_id, status: 'approved' as const };
  });
}
