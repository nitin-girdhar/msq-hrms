// ─────────────────────────────────────────────────────────────────────────────
// Comp-off expiry job.
//
// Run (daily, like accrue-leave):
//   pnpm --filter hr-service lapse-comp-off
//   pnpm --filter hr-service lapse-comp-off -- --date=2026-12-31   # force a date (testing)
//
// An approved claim's credit lapses once expires_on is past. The balance is shared
// by every credit and by leave already taken, so the lapse is capped at what is
// left (lapseAmount) — it never drives the balance negative for a day that was in
// fact spent. Each claim is processed in its own transaction and stamped
// lapsed_at, so a re-run (or a crash halfway) never lapses a claim twice, and the
// ledger entry carries period 'COMPOFF-LAPSE-<claim id>' as a second guard.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withServiceTx, closeAllPools } from '@platform/db';
import { lapseAmount } from '../lib/leave/comp-off.js';

function parseDate(argv: string[]): string {
  const arg = argv.find((a) => a.startsWith('--date='));
  const date = arg ? arg.slice('--date='.length) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid --date: ${date}`);
  return date;
}

interface Due {
  id: string;
  user_id: string;
  org_id: string;
  leave_type_id: string;
  days: number;
}

async function main(): Promise<void> {
  const today = parseDate(process.argv.slice(2));
  const due = await withServiceTx(async (tx) =>
    (await tx.execute(sql`
      SELECT id::text, user_id::text, org_id::text, leave_type_id::text, days::float8 AS days
      FROM hr.comp_off_claims
      WHERE status = 'approved' AND lapsed_at IS NULL AND NOT is_deleted
        AND expires_on < ${today}::date AND leave_type_id IS NOT NULL
      ORDER BY expires_on, created_at
    `)) as unknown as Due[],
  );

  let lapsed = 0;
  let skipped = 0;
  for (const claim of due) {
    await withServiceTx(async (tx) => {
      // Re-check inside the transaction: another run may have got here first.
      const locked = (await tx.execute(sql`
        SELECT 1 FROM hr.comp_off_claims WHERE id = ${claim.id} AND lapsed_at IS NULL FOR UPDATE
      `)) as unknown as unknown[];
      if (locked.length === 0) { skipped += 1; return; }

      const bal = (await tx.execute(sql`
        SELECT COALESCE(SUM(amount), 0)::float8 AS bal
        FROM hr.leave_ledger
        WHERE user_id = ${claim.user_id} AND org_id = ${claim.org_id} AND leave_type_id = ${claim.leave_type_id}
      `)) as unknown as Array<{ bal: number }>;
      const amount = lapseAmount(claim.days, bal[0]?.bal ?? 0);
      if (amount > 0) {
        await tx.execute(sql`
          INSERT INTO hr.leave_ledger
            (user_id, org_id, leave_type_id, entry_type, amount, period, effective_date, note)
          VALUES
            (${claim.user_id}, ${claim.org_id}, ${claim.leave_type_id}, 'lapse', ${-amount},
             ${'COMPOFF-LAPSE-' + claim.id}, ${today}::date, 'Comp-off expired')
        `);
      }
      await tx.execute(sql`UPDATE hr.comp_off_claims SET lapsed_at = CLOCK_TIMESTAMP() WHERE id = ${claim.id}`);
      lapsed += 1;
    });
  }
  console.log(`lapse-comp-off: ${due.length} due, ${lapsed} lapsed, ${skipped} already handled (as of ${today})`);
}

main()
  .catch((err) => {
    console.error('lapse-comp-off failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
