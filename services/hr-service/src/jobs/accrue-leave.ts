// ─────────────────────────────────────────────────────────────────────────────
// Leave accrual + cycle-end job.
//
// Run:
//   pnpm --filter hr-service accrue-leave                # accrue current period
//   pnpm --filter hr-service accrue-leave -- --cycle-end # cycle-end carry/lapse
//   pnpm --filter hr-service accrue-leave -- --date=2026-04-01   # force a date (testing)
//
// Ledger sign convention (see leave.repository): accrual > 0, carry_forward > 0,
// consumption < 0, lapse < 0, adjustment either. Balance = SUM(amount).
//
// The leave cycle is NOT the calendar year — it starts on
// hr.hr_settings.leave_cycle_start_month (org row overrides tenant row; default
// 4 = April→March). Period labels encode the cycle (see lib/leave/policy.ts):
//   monthly 'FY2026-04', quarterly 'FY2026-Q1', yearly 'FY2026',
//   cycle-end lapse 'FY2026-LAPSE'.
//
// Accrual is idempotent via uix_leave_ledger_accrual_period (ON CONFLICT DO
// NOTHING). Cycle-end lapse is made idempotent by an explicit existence check
// on the '<FY>-LAPSE' period (this job is a singleton — no concurrent runs).
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withServiceTx, closeAllPools, type DrizzleTx } from '@crm/db';
import {
  resolveEffectivePolicy,
  resolveCycleStartMonth,
  periodLabel,
  fyLabel,
} from '../lib/leave/policy.js';

interface Args {
  cycleEnd: boolean;
  date: string; // YYYY-MM-DD
}

function parseArgs(argv: string[]): Args {
  const cycleEnd = argv.includes('--cycle-end');
  const dateArg = argv.find((a) => a.startsWith('--date='));
  const date = dateArg ? dateArg.slice('--date='.length) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid --date: ${date}`);
  return { cycleEnd, date };
}

interface Employee {
  user_id: string;
  org_id: string;
  tenant_id: string;
}

interface LeaveType {
  id: string;
  name: string;
}

async function loadEmployees(tx: DrizzleTx): Promise<Employee[]> {
  return (await tx.execute(sql`
    SELECT ep.user_id::text, ep.org_id::text, o.tenant_id::text
    FROM hr.employee_profiles ep
    JOIN entity.organizations o ON o.id = ep.org_id
    WHERE ep.is_active AND NOT ep.is_deleted
  `)) as unknown as Employee[];
}

async function loadLeaveTypes(tx: DrizzleTx): Promise<LeaveType[]> {
  return (await tx.execute(sql`
    SELECT id::text, name FROM hr.leave_types WHERE is_active
  `)) as unknown as LeaveType[];
}

async function balanceFor(tx: DrizzleTx, userId: string, orgId: string, typeId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::float8 AS bal
    FROM hr.leave_ledger
    WHERE user_id = ${userId} AND org_id = ${orgId} AND leave_type_id = ${typeId}
  `)) as unknown as Array<{ bal: number }>;
  return rows[0]?.bal ?? 0;
}

async function runAccrual(tx: DrizzleTx, args: Args): Promise<{ inserted: number; skipped: number }> {
  const employees = await loadEmployees(tx);
  const leaveTypes = await loadLeaveTypes(tx);
  const onDate = new Date(`${args.date}T00:00:00Z`);
  let inserted = 0;
  let skipped = 0;

  for (const emp of employees) {
    const startMonth = await resolveCycleStartMonth(tx, emp.tenant_id, emp.org_id);
    for (const lt of leaveTypes) {
      const policy = await resolveEffectivePolicy(tx, emp.tenant_id, emp.org_id, lt.id, args.date);
      if (!policy || policy.accrual_frequency === 'none') continue;
      const amount = Number(policy.accrual_amount);
      if (amount <= 0) continue;

      const period = periodLabel(onDate, startMonth, policy.accrual_frequency);

      // Cap accrual so the balance never exceeds max_balance.
      let credit = amount;
      if (policy.max_balance != null) {
        const bal = await balanceFor(tx, emp.user_id, emp.org_id, lt.id);
        credit = Math.min(amount, Math.max(0, Number(policy.max_balance) - bal));
      }
      if (credit <= 0) {
        skipped += 1;
        continue;
      }

      const res = (await tx.execute(sql`
        INSERT INTO hr.leave_ledger
          (user_id, org_id, leave_type_id, entry_type, amount, period, effective_date, note)
        VALUES
          (${emp.user_id}, ${emp.org_id}, ${lt.id}, 'accrual', ${credit}, ${period}, ${args.date},
           ${'Auto accrual ' + period})
        ON CONFLICT (user_id, leave_type_id, entry_type, period)
          WHERE entry_type IN ('accrual', 'carry_forward')
        DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (res.length > 0) inserted += 1;
      else skipped += 1;
    }
  }
  return { inserted, skipped };
}

async function runCycleEnd(tx: DrizzleTx, args: Args): Promise<{ lapsed: number }> {
  const employees = await loadEmployees(tx);
  const leaveTypes = await loadLeaveTypes(tx);
  const onDate = new Date(`${args.date}T00:00:00Z`);
  let lapsed = 0;

  for (const emp of employees) {
    const startMonth = await resolveCycleStartMonth(tx, emp.tenant_id, emp.org_id);
    const fy = fyLabel(onDate, startMonth); // cycle being closed
    const period = `${fy}-LAPSE`;

    for (const lt of leaveTypes) {
      const policy = await resolveEffectivePolicy(tx, emp.tenant_id, emp.org_id, lt.id, args.date);
      if (!policy) continue;

      const bal = await balanceFor(tx, emp.user_id, emp.org_id, lt.id);
      if (bal <= 0) continue;

      // carry_forward=true → lapse only the excess over max_carry_forward.
      // carry_forward=false → lapse the whole balance.
      let excess: number;
      if (policy.carry_forward) {
        const cap = policy.max_carry_forward != null ? Number(policy.max_carry_forward) : Infinity;
        excess = bal - cap;
      } else {
        excess = bal;
      }
      if (excess <= 0) continue;

      // Idempotency: one lapse row per (user, type, '<FY>-LAPSE').
      const existing = (await tx.execute(sql`
        SELECT 1 FROM hr.leave_ledger
        WHERE user_id = ${emp.user_id} AND leave_type_id = ${lt.id}
          AND entry_type = 'lapse' AND period = ${period}
        LIMIT 1
      `)) as unknown as Array<Record<string, unknown>>;
      if (existing.length > 0) continue;

      await tx.execute(sql`
        INSERT INTO hr.leave_ledger
          (user_id, org_id, leave_type_id, entry_type, amount, period, effective_date, note)
        VALUES
          (${emp.user_id}, ${emp.org_id}, ${lt.id}, 'lapse', ${-excess}, ${period}, ${args.date},
           ${'Cycle-end lapse ' + period})
      `);
      lapsed += 1;
    }
  }
  return { lapsed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[accrue-leave] mode=${args.cycleEnd ? 'cycle-end' : 'accrual'} date=${args.date}`);

  await withServiceTx(async (tx) => {
    if (args.cycleEnd) {
      const { lapsed } = await runCycleEnd(tx, args);
      console.log(`[accrue-leave] cycle-end complete: ${lapsed} lapse row(s) inserted`);
    } else {
      const { inserted, skipped } = await runAccrual(tx, args);
      console.log(`[accrue-leave] accrual complete: ${inserted} inserted, ${skipped} skipped (idempotent/capped)`);
    }
  });

  await closeAllPools();
}

main().catch(async (err) => {
  console.error('[accrue-leave] FAILED:', err);
  await closeAllPools();
  process.exit(1);
});
