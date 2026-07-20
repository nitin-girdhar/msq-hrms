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
//   4. events exist      → 'present' / 'half_day' per shift thresholds; is_late from
//                          shift start + grace, is_early_exit from shift end.
//   5. else              → 'absent'.
//
// A date already resolved is skipped (idempotent); a row whose resolution_source
// is 'regularization' is NEVER overwritten. "Unresolved" = no attendance_days row.
//
// Timezone: "today", "yesterday" and event→date mapping are all in the org's
// timezone (entity.organizations.timezone) via Postgres AT TIME ZONE.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withServiceTx, closeAllPools, type DrizzleTx } from '@crm/db';
import { orgToday, addDays } from '../lib/attendance/time.js';
import {
  computeDayResolution,
  dayRowExists,
  upsertResolvedDay,
  type DayEmployee,
} from '../lib/attendance/day-resolution.js';

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
    for (const emp of employees) {
      const today = orgToday(emp.timezone);
      const yesterday = addDays(today, -1);
      const from = args.from ?? addDays(yesterday, -(DEFAULT_LOOKBACK_DAYS - 1));
      const to = args.to ?? yesterday;
      if (from > to) continue;

      for (const date of dateRange(from, to)) {
        // Skip any date already resolved (regularization / live events / prior run).
        if (await dayRowExists(tx, emp.user_id, date)) continue;
        const r = await computeDayResolution(tx, emp, date);
        await upsertResolvedDay(tx, emp, date, r, { overwrite: false });
        counts[r.status] = (counts[r.status] ?? 0) + 1;
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
