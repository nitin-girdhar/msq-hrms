import { describe, it, expect, vi } from 'vitest';
import type { SQL, SQLChunk } from 'drizzle-orm';
import { resolveApprovers } from '../resolve-approvers';
import type { DrizzleTx } from '@crm/db';

// Reconstructs the literal SQL text of a drizzle `sql` template so a test can assert
// *which tables a query touches* without a live database. resolveApprovers builds every
// query from raw `sql` template chunks (no Drizzle table refs), so every literal is a
// StringChunk — walking queryChunks and concatenating them recovers the query text
// exactly, params included as `?` (chunk shape).
function queryText(query: SQL): string {
  return (query.queryChunks as SQLChunk[])
    .map((chunk) => (chunk && typeof chunk === 'object' && 'value' in chunk ? (chunk as { value: string[] }).value.join('') : ''))
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
    if (text.includes('hr.reporting_lines')) { seenTables.push('hr.reporting_lines'); return rows.reportingLines; }
    if (text.includes('iam.user_org_mapping') && text.includes('iam.user_roles')) { seenTables.push('fallback_admin'); return rows.fallbackAdmin; }
    if (text.includes('iam.user_org_mapping')) { seenTables.push('iam.user_org_mapping'); return rows.orgActiveUsers; }
    if (text.includes('iam.users')) { seenTables.push('iam.users'); return rows.activeUsers; }
    throw new Error(`resolveApprovers issued an unexpected query: ${text}`);
  });
  const tx = { execute } as unknown as DrizzleTx;
  return { tx, seenTables, execute };
}

describe('resolveApprovers — HR/LMS hierarchy independence', () => {
  const orgId = 'org-1';

  it('never queries the LMS assignment tree (iam.vw_user_team_members)', async () => {
    const { tx, execute } = makeTx({
      reportingLines: [{ user_id: 'emp', manager_id: 'hr-mgr' }],
      activeUsers: [{ id: 'emp' }, { id: 'hr-mgr' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'hr-mgr' }],
      fallbackAdmin: [],
    });

    await resolveApprovers(tx, orgId, 'emp', 1);

    for (const call of execute.mock.calls) {
      expect(queryText(call[0] as SQL)).not.toContain('vw_user_team_members');
    }
  });

  it('resolves purely from hr.reporting_lines even when the LMS manager tree (iam.users.manager_id) disagrees', async () => {
    // The LMS side (iam.vw_user_team_members) is derived from iam.users.manager_id and
    // would place 'emp' under 'lms-lead' — a completely different person than HR's chain.
    // resolveApprovers must never consult that tree: only hr.reporting_lines drives the
    // approval chain (see resolve-approvers.ts header comment).
    const { tx } = makeTx({
      reportingLines: [
        { user_id: 'emp', manager_id: 'hr-mgr' },
        { user_id: 'hr-mgr', manager_id: 'hr-director' },
      ],
      activeUsers: [{ id: 'emp' }, { id: 'hr-mgr' }, { id: 'hr-director' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'hr-mgr' }, { user_id: 'hr-director' }],
      fallbackAdmin: [],
    });

    const approvers = await resolveApprovers(tx, orgId, 'emp', 2);

    // Chain follows hr.reporting_lines ('hr-mgr' -> 'hr-director'), not any LMS lead/manager.
    expect(approvers).toEqual([
      { level: 1, approverId: 'hr-mgr' },
      { level: 2, approverId: 'hr-director' },
    ]);
  });

  it('falls back to the org_admin/hr_admin when hr.reporting_lines has no line, even though the requester has an LMS manager', async () => {
    // A rep can be assigned under an LMS lead (iam.users.manager_id / vw_user_team_members)
    // while having no HR reporting line at all — the two hierarchies are independent, so HR
    // falls back to the deterministic admin rather than inferring anything from the LMS tree.
    const { tx } = makeTx({
      reportingLines: [],
      activeUsers: [{ id: 'emp' }, { id: 'org-admin-1' }],
      orgActiveUsers: [{ user_id: 'emp' }, { user_id: 'org-admin-1' }],
      fallbackAdmin: [{ user_id: 'org-admin-1' }],
    });

    const approvers = await resolveApprovers(tx, orgId, 'emp', 1);
    expect(approvers).toEqual([{ level: 1, approverId: 'org-admin-1' }]);
  });
});
