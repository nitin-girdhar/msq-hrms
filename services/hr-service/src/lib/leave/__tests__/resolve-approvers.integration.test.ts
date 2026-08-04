import { describe, it, expect, vi } from 'vitest';
import type { SQL, SQLChunk } from 'drizzle-orm';
import { resolveApprovers } from '../resolve-approvers';
import type { DrizzleTx } from '@platform/db';

// Reconstructs the literal SQL text of a drizzle `sql` template so a test can assert
// *which tables a query touches* without a live database. resolveApprovers builds every
// query from raw `sql` template chunks (no Drizzle table refs), so every literal is a
// StringChunk — walking queryChunks and concatenating them recovers the query text
// exactly, params included as `?` (chunk shape).
// Recurses into nested `sql` fragments: resolveApprovers composes its effective-date
// predicate from a sub-fragment, and a flat walk would silently drop it — making a
// test that asserts on that predicate pass for the wrong reason.
function queryText(query: SQL): string {
  return (query.queryChunks as SQLChunk[])
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      if ('queryChunks' in chunk) return queryText(chunk as SQL);
      if ('value' in chunk) return (chunk as { value: string[] }).value.join('');
      return '';
    })
    .join('');
}

/**
 * Mock tx.execute that dispatches by which table the query text references, not by call
 * order — so it stays correct even if resolveApprovers reorders its four reads.
 */
function makeTx(rows: {
  reportingLines: Array<{ user_id: string; manager_id: string }>;
  activeUsers: Array<{ id: string }>;
  orgActiveUsers: Array<{ user_id: string }>;
  fallbackAdmin: Array<{ user_id: string }>;
}) {
  const seenTables: string[] = [];
  const execute = vi.fn(async (query: SQL) => {
    const text = queryText(query);
    if (text.includes('iam.reporting_lines')) { seenTables.push('iam.reporting_lines'); return rows.reportingLines; }
    if (text.includes('iam.user_org_mapping') && text.includes('iam.user_roles')) { seenTables.push('fallback_admin'); return rows.fallbackAdmin; }
    if (text.includes('iam.user_org_mapping')) { seenTables.push('iam.user_org_mapping'); return rows.orgActiveUsers; }
    if (text.includes('iam.users')) { seenTables.push('iam.users'); return rows.activeUsers; }
    throw new Error(`resolveApprovers issued an unexpected query: ${text}`);
  });
  const tx = { execute } as unknown as DrizzleTx;
  return { tx, seenTables, execute };
}

// These tests used to assert the OPPOSITE: that HR approvals were resolved from a
// private hr.reporting_lines tree which deliberately diverged from the LMS one.
// That split is gone — there is now a single platform hierarchy in
// iam.reporting_lines, and these tests pin the convergence so it cannot be
// quietly re-forked.
describe('resolveApprovers — the single platform hierarchy', () => {
  const orgId = 'org-1';

  it('reads iam.reporting_lines — the same tree LMS and Tasks resolve against', async () => {
    const { tx, seenTables } = makeTx({
      reportingLines: [{ user_id: 'emp', manager_id: 'mgr' }],
      activeUsers: [{ id: 'emp' }, { id: 'mgr' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'mgr' }],
      fallbackAdmin: [],
    });

    await resolveApprovers(tx, orgId, 'emp', 1);

    expect(seenTables).toContain('iam.reporting_lines');
  });

  it('never reads the retired hr.reporting_lines or the manager_id display mirror', async () => {
    const { tx, execute } = makeTx({
      reportingLines: [{ user_id: 'emp', manager_id: 'mgr' }],
      activeUsers: [{ id: 'emp' }, { id: 'mgr' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'mgr' }],
      fallbackAdmin: [],
    });

    await resolveApprovers(tx, orgId, 'emp', 1);

    for (const call of execute.mock.calls) {
      const text = queryText(call[0] as SQL);
      // hr.reporting_lines was dropped in 1.27.0.
      expect(text).not.toContain('hr.reporting_lines');
      // iam.users.manager_id is a display mirror maintained by a trigger; reading
      // it for authority would reintroduce a second, disagreeing source of truth.
      expect(text).not.toContain('manager_id FROM iam.users');
    }
  });

  it('walks the chain upward, so a skip-level manager approves too', async () => {
    const { tx } = makeTx({
      reportingLines: [
        { user_id: 'emp', manager_id: 'mgr' },
        { user_id: 'mgr', manager_id: 'director' },
      ],
      activeUsers: [{ id: 'emp' }, { id: 'mgr' }, { id: 'director' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'mgr' }, { user_id: 'director' }],
      fallbackAdmin: [],
    });

    const approvers = await resolveApprovers(tx, orgId, 'emp', 2);

    expect(approvers).toEqual([
      { level: 1, approverId: 'mgr' },
      { level: 2, approverId: 'director' },
    ]);
  });

  it('falls back to the org_admin/hr_admin when the requester has no reporting line', async () => {
    // No line means no manager — the fallback is deterministic rather than
    // inferred, so a user outside the tree still has someone who can approve.
    const { tx } = makeTx({
      reportingLines: [],
      activeUsers: [{ id: 'emp' }, { id: 'org-admin-1' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'org-admin-1' }],
      fallbackAdmin: [{ user_id: 'org-admin-1' }],
    });

    const approvers = await resolveApprovers(tx, orgId, 'emp', 1);
    expect(approvers).toEqual([{ level: 1, approverId: 'org-admin-1' }]);
  });

  it('resolves as of the supplied date, not today, so a backdated request keeps its own chain', async () => {
    const fixture = {
      reportingLines: [{ user_id: 'emp', manager_id: 'mgr-back-then' }],
      activeUsers: [{ id: 'emp' }, { id: 'mgr-back-then' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'mgr-back-then' }],
      fallbackAdmin: [],
    };
    const lineQueryOf = (execute: { mock: { calls: unknown[][] } }) =>
      execute.mock.calls
        .map((call) => queryText(call[0] as SQL))
        .find((text) => text.includes('iam.reporting_lines'));

    // Default path: the effective-date predicate is the literal CURRENT_DATE.
    const today = makeTx(fixture);
    await resolveApprovers(today.tx, orgId, 'emp', 1);
    expect(lineQueryOf(today.execute)).toContain('CURRENT_DATE');

    // With an as-of date it becomes a bound parameter instead. queryText only
    // recovers string chunks, so the parameter itself is invisible here — the
    // observable signal is that CURRENT_DATE is gone.
    const backdated = makeTx(fixture);
    await resolveApprovers(backdated.tx, orgId, 'emp', 1, new Date('2026-03-14T00:00:00Z'));
    expect(lineQueryOf(backdated.execute)).not.toContain('CURRENT_DATE');
  });
});
