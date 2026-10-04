// ─────────────────────────────────────────────────────────────────────────────
// Payroll viewer helpers. Pure (no DB, no clock) except assertPeriodOpen, which
// reads one row. This is NOT a payroll engine: it only totals the lines HR typed
// in and answers "is this month locked?".
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import type { DrizzleTx } from '@platform/db';
import { ConflictError } from '../errors.js';

export interface LineInput {
  kind: 'earning' | 'deduction';
  label: string;
  amount: number;
}

export interface Totals {
  gross: number;
  deductions: number;
  net: number;
}

/** Money is summed in whole paise so 0.1 + 0.2 never drifts; results are rupees to 2 d.p. */
export function computeTotals(lines: readonly LineInput[]): Totals {
  let gross = 0;
  let deductions = 0;
  for (const l of lines) {
    const paise = Math.round(l.amount * 100);
    if (l.kind === 'earning') gross += paise;
    else deductions += paise;
  }
  return { gross: gross / 100, deductions: deductions / 100, net: (gross - deductions) / 100 };
}

/** 'YYYY-MM' → first day of that month as 'YYYY-MM-01'. */
export function monthStart(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Invalid month: ${month}`);
  return `${month}-01`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(isoDate: string): string {
  return `${MONTHS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}`;
}

/**
 * Refuse a change to attendance for a date in a locked pay month. Called at the
 * human-driven correction paths (creating/approving a regularization, recompute).
 * Live punches and the nightly job are not blocked: they work on the current day.
 */
export async function assertPeriodOpen(tx: DrizzleTx, orgId: string, date: string): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM hr.pay_periods
    WHERE org_id = ${orgId} AND period = date_trunc('month', ${date}::date)::date AND status = 'locked' AND NOT is_deleted
    LIMIT 1
  `)) as unknown as unknown[];
  if (rows.length > 0) {
    throw new ConflictError(`Payroll for ${monthLabel(date.slice(0, 7) + '-01')} is locked, so attendance for that month can no longer be changed`);
  }
}
