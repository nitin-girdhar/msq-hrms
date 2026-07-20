// ─────────────────────────────────────────────────────────────────────────────
// Leave-policy resolution + leave-cycle arithmetic.
//
// Effective policy for (tenant, org, leave_type, date) = the org-specific row
// if one exists, else the tenant-wide row (org_id IS NULL), taking the latest
// applicable_from that is <= date. Effective-dated: history is never mutated.
//
// The leave cycle is NOT the calendar year. It starts on
// hr.hr_settings.leave_cycle_start_month (org row overrides tenant row;
// default 4 = April → March, India FY).
//
// Period-label convention (encoded in hr.leave_ledger.period):
//   monthly    'FY2026-04'   — cycle FY2026, calendar month 04
//   quarterly  'FY2026-Q1'   — cycle FY2026, quarter 1 (from cycle start)
//   yearly     'FY2026'      — whole cycle
//   carry_fwd  'FY2027-CF'   — opening carry-forward into cycle FY2027
//   lapse      'FY2026-LAPSE'— end-of-cycle lapse of cycle FY2026
// where FY<year> is the CALENDAR YEAR IN WHICH THE CYCLE STARTS.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import type { DrizzleTx } from '@platform/db';

export interface EffectiveLeavePolicy {
  id: string;
  tenant_id: string;
  org_id: string | null;
  leave_type_id: string;
  accrual_frequency: 'monthly' | 'quarterly' | 'yearly' | 'none';
  accrual_amount: string;
  max_balance: string | null;
  carry_forward: boolean;
  max_carry_forward: string | null;
  max_consecutive_days: number | null;
  min_notice_days: number;
  allow_half_day: boolean;
  requires_document_after_days: number | null;
  approval_levels: number;
  applicable_from: string;
}

/**
 * Resolve the single effective policy for a (tenant, org, leave_type) as of a
 * date. Org-specific rows win over tenant-wide rows; ties broken by the latest
 * applicable_from.
 */
export async function resolveEffectivePolicy(
  tx: DrizzleTx,
  tenantId: string,
  orgId: string,
  leaveTypeId: string,
  onDate: string,
): Promise<EffectiveLeavePolicy | null> {
  const rows = (await tx.execute(sql`
    SELECT
      id::text, tenant_id::text, org_id::text, leave_type_id::text,
      accrual_frequency, accrual_amount::text, max_balance::text,
      carry_forward, max_carry_forward::text, max_consecutive_days,
      min_notice_days, allow_half_day, requires_document_after_days,
      approval_levels, applicable_from::text
    FROM hr.leave_policies
    WHERE tenant_id = ${tenantId}
      AND leave_type_id = ${leaveTypeId}
      AND is_active AND NOT is_deleted
      AND applicable_from <= ${onDate}
      AND (org_id = ${orgId} OR org_id IS NULL)
    ORDER BY (org_id IS NOT NULL) DESC, applicable_from DESC
    LIMIT 1
  `)) as unknown as EffectiveLeavePolicy[];
  return rows[0] ?? null;
}

/**
 * Effective leave-cycle start month for an org: the org's hr_settings row wins
 * over the tenant-wide row; default 4 (April) when neither exists.
 */
export async function resolveCycleStartMonth(
  tx: DrizzleTx,
  tenantId: string,
  orgId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT leave_cycle_start_month
    FROM hr.hr_settings
    WHERE tenant_id = ${tenantId}
      AND (org_id = ${orgId} OR org_id IS NULL)
    ORDER BY (org_id IS NOT NULL) DESC
    LIMIT 1
  `)) as unknown as Array<{ leave_cycle_start_month: number }>;
  return rows[0]?.leave_cycle_start_month ?? 4;
}

/** Calendar year in which the cycle containing `date` started. */
export function cycleStartYear(date: Date, startMonth: number): number {
  const month = date.getUTCMonth() + 1; // 1..12
  return month >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** 'FY2026' style label for the cycle containing `date`. */
export function fyLabel(date: Date, startMonth: number): string {
  return `FY${cycleStartYear(date, startMonth)}`;
}

/** Quarter index (1..4) within the cycle for `date`. */
export function cycleQuarter(date: Date, startMonth: number): number {
  const month = date.getUTCMonth() + 1;
  const monthsIn = (month - startMonth + 12) % 12; // 0..11
  return Math.floor(monthsIn / 3) + 1;
}

/**
 * Ledger period label for an accrual firing on `date` at a given frequency.
 */
export function periodLabel(
  date: Date,
  startMonth: number,
  frequency: 'monthly' | 'quarterly' | 'yearly',
): string {
  const fy = fyLabel(date, startMonth);
  if (frequency === 'yearly') return fy;
  if (frequency === 'quarterly') return `${fy}-Q${cycleQuarter(date, startMonth)}`;
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${fy}-${mm}`;
}
