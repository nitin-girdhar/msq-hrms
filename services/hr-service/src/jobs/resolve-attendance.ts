// ─────────────────────────────────────────────────────────────────────────────
// Nightly attendance resolution job.
//
// Run:
//   pnpm --filter @crm/hr-service resolve-attendance                    # last 3 days → yesterday
//   pnpm --filter @crm/hr-service resolve-attendance -- --from=2026-07-01 --to=2026-07-07
//
// For each active employee and each UNRESOLVED date up to yesterday (org-local),
// resolve a status in this precedence order (Platform_Expansion_Plan §4.3):
//   1. org holiday      → 'holiday'
//   2. weekly off       → 'weekly_off'  (employee weekly_off_pattern)
//   3. approved leave    → 'on_leave' (+ leave_request_id); a HALF-DAY leave with
//                          no punches resolves to 'half_day' (documented rule).
//   4. events exist      → 'present' / 'half_day' / 'absent' per shift thresholds,
//                          'missed_punch' if a check-in was never closed; is_late from
//                          shift start + grace, is_early_exit from shift end.
//   5. else              → 'absent'.
//
// A date already resolved is skipped (idempotent); a row whose resolution_source
// is 'regularization' is NEVER overwritten. "Unresolved" = no attendance_days row.
//
// Second pass — FINALIZE OPEN DAYS. A day the live punch wrote with a check-in
// never closed was stored as a tentative 'present'. Once the work day is over
// (isDayFinished; a night shift ends the next morning) it is recomputed and
// becomes 'missed_punch'. Only punch-resolved rows are touched, and they are
// re-derived from their punches alone (resolveFromEvents), so a check-in on a
// holiday or weekly off is finalized too instead of re-resolving to 'weekly_off'.
//
// Timezone: "today", "yesterday" and event→date mapping are all in the org's
// timezone (entity.organizations.timezone) via Postgres AT TIME ZONE.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withServiceTx, closeAllPools, type DrizzleTx } from '@platform/db';
import { orgToday, addDays } from '../lib/attendance/time.js';
import {
  computeDayResolution,
  resolveFromEvents,
  dayRowExists,
  upsertResolvedDay,
  type DayEmployee,
} from '../lib/attendance/day-resolution.js';
import type { ShiftThresholds } from '../lib/attendance/resolve.js';

const DEFAULT_LOOKBACK_DAYS = 3;

interface Args {
  from: string | null;
  to: string | null;
}

function parseArgs(argv: string[]): Args {
  const fromArg = argv.find((a) => a.startsWith('--from='));
  const toArg = argv.find((a) => a.startsWith('--to='));
  const from = fromArg ? fromArg.slice('--from='.length) : null;
  const to = toArg ? toArg.slice('--to='.length) : null;
  for (const d of [from, to]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Invalid date flag: ${d}`);
  }
  return { from, to };
}

async function loadEmployees(tx: DrizzleTx): Promise<DayEmployee[]> {
  return (await tx.execute(sql`
    SELECT ep.user_id::text, ep.org_id::text, ep.tenant_id::text, o.timezone,
           ep.weekly_off_pattern AS weekly_off_pattern
    FROM hr.employee_profiles ep
    JOIN entity.organizations o ON o.id = ep.org_id
    WHERE ep.is_active AND NOT ep.is_deleted
  `)) as unknown as DayEmployee[];
}

/**
 * Org-level day-classification thresholds, loaded once for the whole run rather
 * than per (employee, date). Orgs with no applicable attendance_rules row are
 * simply absent from the map, and computeDayResolution falls back to
 * DEFAULT_THRESHOLDS.
 *
 * The row that applies to an org may be its own OR the tenant-wide default
 * (org_id NULL), so this resolves the same org-over-tenant precedence
 * loadRulesRow does and keys the result by org. Selecting straight from
 * attendance_rules would key a tenant-wide row under a NULL org and leave every
 * org inheriting it absent — silently classifying their days against
 * DEFAULT_THRESHOLDS instead of the thresholds their admin configured.
 */
async function loadOrgThresholds(tx: DrizzleTx): Promise<Map<string, ShiftThresholds>> {
  const rows = (await tx.execute(sql`
    SELECT o.id::text AS org_id, r.min_half_day_minutes, r.min_full_day_minutes
    FROM entity.organizations o
    JOIN LATERAL (
      SELECT ar.min_half_day_minutes, ar.min_full_day_minutes
      FROM hr.attendance_rules ar
      WHERE ar.tenant_id = o.tenant_id
        AND NOT ar.is_deleted
        AND (ar.org_id = o.id OR ar.org_id IS NULL)
      -- FALSE sorts before TRUE, so the org's own row wins over the default.
      ORDER BY (ar.org_id IS NULL)
      LIMIT 1
    ) r ON TRUE
  `)) as unknown as Array<{ org_id: string; min_half_day_minutes: number; min_full_day_minutes: number }>;
  return new Map(
    rows.map((r) => [
      r.org_id,
      { minHalfDayMinutes: r.min_half_day_minutes, minFullDayMinutes: r.min_full_day_minutes },
    ]),
  );
}

/** Punch-resolved days in [from, to] still holding an unclosed check-in. */
async function openDaysToFinalize(tx: DrizzleTx, userId: string, from: string, to: string): Promise<string[]> {
  const rows = (await tx.execute(sql`
    SELECT ad.work_date::text AS work_date
    FROM hr.attendance_days ad
    JOIN hr.attendance_statuses st ON st.id = ad.status_id
    WHERE ad.user_id = ${userId}
      AND ad.work_date BETWEEN ${from}::date AND ${to}::date
      AND ad.has_open_session
      AND ad.resolution_source = 'events'
      AND st.name <> 'missed_punch'
    ORDER BY ad.work_date
  `)) as unknown as Array<{ work_date: string }>;
  return rows.map((r) => r.work_date);
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[resolve-attendance] from=${args.from ?? 'auto'} to=${args.to ?? 'auto'}`);

  const counts: Record<string, number> = {};

  await withServiceTx(async (tx) => {
    const employees = await loadEmployees(tx);
    const orgThresholds = await loadOrgThresholds(tx);
    for (const emp of employees) {
      const today = orgToday(emp.timezone);
      const yesterday = addDays(today, -1);
      const from = args.from ?? addDays(yesterday, -(DEFAULT_LOOKBACK_DAYS - 1));
      const to = args.to ?? yesterday;
      if (from > to) continue;

      for (const date of dateRange(from, to)) {
        // Skip any date already resolved (regularization / live events / prior run).
        if (await dayRowExists(tx, emp.user_id, date)) continue;
        const r = await computeDayResolution(tx, emp, date, orgThresholds.get(emp.org_id));
        await upsertResolvedDay(tx, emp, date, r, { overwrite: false });
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      }

      for (const date of await openDaysToFinalize(tx, emp.user_id, from, to)) {
        const r = await resolveFromEvents(tx, emp, date, orgThresholds.get(emp.org_id));
        if (r?.status !== 'missed_punch') continue;
        await upsertResolvedDay(tx, emp, date, r, { overwrite: true });
        counts['finalized_missed_punch'] = (counts['finalized_missed_punch'] ?? 0) + 1;
      }
    }
  });

  const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || '(nothing to resolve)';
  console.log(`[resolve-attendance] complete: ${summary}`);
  await closeAllPools();
}

main().catch(async (err) => {
  console.error('[resolve-attendance] FAILED:', err);
  await closeAllPools();
  process.exit(1);
});
