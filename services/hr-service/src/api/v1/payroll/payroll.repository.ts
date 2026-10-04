// ─────────────────────────────────────────────────────────────────────────────
// Payroll viewer repository (schema 1.62.0).
//
//   - An employee's own payslips are read in withRoleTx: the payslips self policy
//     pins the rows to the caller AND to published ones, so the database enforces
//     "your own, once published" independently of this code.
//   - Everything else (drafting, publishing, locking, listing others') runs in the
//     service transaction behind hr.reports.payroll.manage, org-fenced on every query.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, type DrizzleTx, type RoleTxContext } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import { computeTotals, monthStart } from '../../../lib/payroll/payroll.js';
import type { UpsertPayslipInput } from '@hr/validation';

type Ctx = RoleTxContext;

export interface PayslipSummary {
  id: string;
  period: string;
  working_days: number | null;
  lop_days: number | null;
  gross: number;
  deductions: number;
  net: number;
  published_at: string | null;
}
export interface PayslipLine {
  kind: 'earning' | 'deduction';
  label: string;
  amount: number;
}
export interface PayslipDetail extends PayslipSummary {
  user_full_name: string;
  employee_code: string | null;
  lines: PayslipLine[];
}

const SUMMARY = sql`
  p.id::text, p.period::text, p.working_days::float8 AS working_days, p.lop_days::float8 AS lop_days,
  p.gross::float8 AS gross, p.deductions::float8 AS deductions, p.net::float8 AS net, p.published_at::text AS published_at
`;

async function withContext<T>(ctx: Ctx, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return withServiceTx(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`);
    return fn(tx);
  });
}

// ── Employee (own, published) ────────────────────────────────────────────────
export async function listOwn(ctx: Ctx): Promise<PayslipSummary[]> {
  return withRoleTx(ctx, async (tx) =>
    (await tx.execute(sql`
      SELECT ${SUMMARY} FROM hr.payslips p
      WHERE p.user_id = ${ctx.user_id} AND NOT p.is_deleted
      ORDER BY p.period DESC LIMIT 60
    `)) as unknown as PayslipSummary[],
  );
}

export async function getOwn(ctx: Ctx, id: string): Promise<PayslipDetail> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${SUMMARY}, u.full_name AS user_full_name, ep.employee_code
      FROM hr.payslips p
      JOIN iam.users u ON u.id = p.user_id
      LEFT JOIN hr.employee_profiles ep ON ep.user_id = p.user_id
      WHERE p.id = ${id} AND p.user_id = ${ctx.user_id} AND NOT p.is_deleted
    `)) as unknown as Array<Omit<PayslipDetail, 'lines'>>;
    if (!rows[0]) throw new NotFoundError('Payslip not found');
    const lines = (await tx.execute(sql`
      SELECT kind, label, amount::float8 AS amount FROM hr.payslip_lines WHERE payslip_id = ${id} ORDER BY kind DESC, sort_order
    `)) as unknown as PayslipLine[];
    return { ...rows[0], lines };
  });
}

// ── HR (service transaction) ─────────────────────────────────────────────────
export interface PayrollOverview {
  month: string;
  status: 'open' | 'locked';
  locked_at: string | null;
  payslips: Array<PayslipSummary & { user_id: string; user_full_name: string }>;
}

export async function overview(ctx: Ctx, month: string): Promise<PayrollOverview> {
  const period = monthStart(month);
  return withContext(ctx, async (tx) => {
    const per = (await tx.execute(sql`
      SELECT status, locked_at::text AS locked_at FROM hr.pay_periods
      WHERE org_id = ${ctx.org_id} AND period = ${period}::date AND NOT is_deleted
    `)) as unknown as Array<{ status: 'open' | 'locked'; locked_at: string | null }>;
    const payslips = (await tx.execute(sql`
      SELECT ${SUMMARY}, p.user_id::text AS user_id, u.full_name AS user_full_name
      FROM hr.payslips p JOIN iam.users u ON u.id = p.user_id
      WHERE p.org_id = ${ctx.org_id} AND p.period = ${period}::date AND NOT p.is_deleted
      ORDER BY u.full_name
    `)) as unknown as PayrollOverview['payslips'];
    return { month, status: per[0]?.status ?? 'open', locked_at: per[0]?.locked_at ?? null, payslips };
  });
}

export async function upsertDraft(ctx: Ctx, data: UpsertPayslipInput): Promise<{ id: string }> {
  const period = monthStart(data.month);
  const totals = computeTotals(data.lines);
  return withContext(ctx, async (tx) => {
    const emp = (await tx.execute(sql`
      SELECT 1 FROM hr.employee_profiles WHERE user_id = ${data.user_id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as unknown[];
    if (emp.length === 0) throw new NotFoundError('Employee not found');

    const existing = (await tx.execute(sql`
      SELECT id::text, published_at FROM hr.payslips
      WHERE user_id = ${data.user_id} AND period = ${period}::date AND org_id = ${ctx.org_id} AND NOT is_deleted
      FOR UPDATE
    `)) as unknown as Array<{ id: string; published_at: string | null }>;
    // A published payslip is what the employee has already seen; changing it silently would be a lie.
    if (existing[0]?.published_at) throw new ConflictError('That payslip is already published and can no longer be edited');

    let id = existing[0]?.id;
    if (id) {
      await tx.execute(sql`
        UPDATE hr.payslips SET working_days = ${data.working_days ?? null}, lop_days = ${data.lop_days ?? null},
               gross = ${totals.gross}, deductions = ${totals.deductions}, net = ${totals.net}
        WHERE id = ${id}`);
      await tx.execute(sql`DELETE FROM hr.payslip_lines WHERE payslip_id = ${id}`);
    } else {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.payslips (org_id, user_id, period, working_days, lop_days, gross, deductions, net, created_by)
        VALUES (${ctx.org_id}, ${data.user_id}, ${period}::date, ${data.working_days ?? null}, ${data.lop_days ?? null},
                ${totals.gross}, ${totals.deductions}, ${totals.net}, ${ctx.user_id})
        RETURNING id::text`)) as unknown as Array<{ id: string }>;
      id = rows[0]!.id;
    }
    let order = 0;
    for (const l of data.lines) {
      await tx.execute(sql`
        INSERT INTO hr.payslip_lines (payslip_id, org_id, kind, label, amount, sort_order)
        VALUES (${id}, ${ctx.org_id}, ${l.kind}, ${l.label}, ${l.amount}, ${order++})`);
    }
    return { id: id! };
  });
}

/** Publish every draft of the month at once. Returns how many became visible to employees. */
export async function publish(ctx: Ctx, month: string): Promise<{ published: number }> {
  const period = monthStart(month);
  return withContext(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      UPDATE hr.payslips SET published_at = CLOCK_TIMESTAMP(), published_by = ${ctx.user_id}
      WHERE org_id = ${ctx.org_id} AND period = ${period}::date AND published_at IS NULL AND NOT is_deleted
      RETURNING id::text`)) as unknown as unknown[];
    if (rows.length === 0) throw new BadRequestError('There are no draft payslips to publish for that month');
    return { published: rows.length };
  });
}

export async function setLock(ctx: Ctx, month: string, locked: boolean): Promise<{ status: 'open' | 'locked' }> {
  const period = monthStart(month);
  return withContext(ctx, async (tx) => {
    await tx.execute(sql`
      INSERT INTO hr.pay_periods (org_id, period, status, locked_by, locked_at)
      VALUES (${ctx.org_id}, ${period}::date, ${locked ? 'locked' : 'open'},
              ${locked ? ctx.user_id : null}, ${locked ? sql`CLOCK_TIMESTAMP()` : sql`NULL`})
      ON CONFLICT (org_id, period) WHERE NOT is_deleted
      DO UPDATE SET status = EXCLUDED.status, locked_by = EXCLUDED.locked_by, locked_at = EXCLUDED.locked_at`);
    return { status: locked ? ('locked' as const) : ('open' as const) };
  });
}
