// ─────────────────────────────────────────────────────────────────────────────
// GET /leave/balances is the only leave endpoint an ordinary employee may call,
// so its SELECT list IS the privacy boundary: the balance per type, never the
// policy that produced it. This test reads the query text back out of the
// drizzle `sql` template (same trick as resolve-approvers.integration.test.ts —
// no database needed) and fails if an admin-only column is ever selected into
// it. Adding a column here is a deliberate act, not a drive-by.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { SQL, SQLChunk } from 'drizzle-orm';
import { balancesQuery } from '../leave.repository';

// Recursive: the optional `AND ll.effective_date <= …` rides along as a nested
// sql fragment, which is an SQL object chunk rather than a plain StringChunk.
function queryText(query: SQL): string {
  return (query.queryChunks as SQLChunk[])
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      if ('value' in chunk) return (chunk as { value: string[] }).value.join('');
      if ('queryChunks' in chunk) return queryText(chunk as SQL);
      return '';
    })
    .join('');
}

/** The SELECT list of the outer query — everything that reaches the client. */
function selectList(text: string): string {
  return text.slice(text.lastIndexOf('SELECT'), text.lastIndexOf('FROM hr.leave_types'));
}

const query = (boundLedger = false) => queryText(balancesQuery('u1', 'o1', 't1', '2026-07-28', boundLedger));

describe('balances payload', () => {
  it('selects only the seven employee-facing fields', () => {
    const list = selectList(query());
    for (const field of [
      'leave_type_id',
      'leave_type_name',
      'leave_type_label',
      'is_paid',
      'balance',
      'allow_half_day',
      'has_policy',
    ]) {
      expect(list).toContain(field);
    }
  });

  it('never selects leave-policy internals', () => {
    const list = selectList(query());
    for (const column of [
      'accrual_frequency',
      'accrual_amount',
      'max_balance',
      'carry_forward',
      'max_carry_forward',
      'max_consecutive_days',
      'min_notice_days',
      'requires_document_after_days',
      'approval_levels',
      'applicable_from',
    ]) {
      expect(list, `${column} is admin-only (hr.leave.admin.policies.view)`).not.toContain(column);
    }
  });

  it('dates the effective policy by as_of', () => {
    // Org row beats tenant-wide, latest applicable_from wins — the server-side
    // rule that replaced the browser's copy of it in ApplyLeaveModal.
    expect(query()).toContain('p.applicable_from <=');
    expect(query()).toContain('ORDER BY p.leave_type_id, (p.org_id IS NOT NULL) DESC, p.applicable_from DESC');
  });

  it('bounds the ledger sum only when as_of was explicit', () => {
    // Approved leave lands in the ledger with effective_date = start_date, i.e.
    // usually in the future, while currentBalance() sums it unbounded. A default
    // date bound here would promise more days than the apply flow allows.
    expect(query(false)).not.toContain('ll.effective_date');
    expect(query(true)).toContain('ll.effective_date <=');
  });

  it('shows a type that is bookable or still carries a residual balance', () => {
    expect(query()).toContain('AND (eff.leave_type_id IS NOT NULL OR led.leave_type_id IS NOT NULL)');
  });
});
