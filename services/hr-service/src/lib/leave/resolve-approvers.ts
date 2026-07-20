// ─────────────────────────────────────────────────────────────────────────────
// Approver-chain resolution.
//
// The org's approval chain walks the effective-dated HR reporting hierarchy
// (hr.reporting_lines) upward `levels` steps. The chain is resolved as of the
// current date (the request's apply time). iam.users.manager_id is NO LONGER
// consulted here — it is an optional org default that only seeds the initial
// reporting lines (db_scripts/21). See Platform_Architecture_Decisions.
//
// Rules (Platform_Expansion_Plan §4.2):
//   - Skip managers who are inactive or not active in the org — keep walking
//     up past them; a skipped manager does NOT consume a level.
//   - If the chain runs out before reaching `levels`, the last resolvable
//     manager becomes the final level (never pad with duplicates).
//   - If the requester has no resolvable manager at all, level 1 falls back to
//     a deterministic org_admin/hr_admin (lowest user id).
//   - The same person never appears at two levels (dedupe).
//
// The graph-walking logic is a pure function (`buildApproverChain`) so every
// case is unit-testable without a database. `resolveApprovers` pre-fetches the
// org's reporting graph + active-membership set and hands it to the pure
// function.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import type { DrizzleTx } from '@platform/db';

export interface ApproverAssignment {
  level: number;
  approverId: string;
}

/**
 * Read model the pure resolver walks. Deliberately synchronous so the chain
 * logic is exhaustively unit-testable.
 */
export interface ApproverGraph {
  /** manager_id of a user, or null if none / user unknown. */
  managerOf(userId: string): string | null;
  /** true when the user exists, is active, and is active in the target org. */
  isActiveInOrg(userId: string): boolean;
  /** deterministic org_admin/hr_admin fallback (lowest user id), or null. */
  fallbackAdmin(): string | null;
}

/**
 * Pure chain builder. Walks upward from the requester's manager, skipping
 * inactive/out-of-org managers, until `levels` approvers are collected or the
 * chain is exhausted. Guards against cycles via a visited set.
 */
export function buildApproverChain(
  requesterId: string,
  levels: number,
  graph: ApproverGraph,
): ApproverAssignment[] {
  const approvers: ApproverAssignment[] = [];
  const chosen = new Set<string>();
  const visited = new Set<string>([requesterId]);

  let cursor = graph.managerOf(requesterId);
  while (approvers.length < levels && cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (graph.isActiveInOrg(cursor) && !chosen.has(cursor)) {
      approvers.push({ level: approvers.length + 1, approverId: cursor });
      chosen.add(cursor);
    }
    cursor = graph.managerOf(cursor);
  }

  // No resolvable manager anywhere in the chain → deterministic admin fallback.
  if (approvers.length === 0) {
    const fallback = graph.fallbackAdmin();
    if (fallback && fallback !== requesterId) {
      approvers.push({ level: 1, approverId: fallback });
    }
  }

  return approvers;
}

/**
 * DB-backed approver resolution. Pre-fetches the org's effective reporting
 * graph (as of today), the org's active-membership set, and the deterministic
 * admin fallback, then delegates to `buildApproverChain`.
 */
export async function resolveApprovers(
  tx: DrizzleTx,
  orgId: string,
  requesterId: string,
  levels: number,
): Promise<ApproverAssignment[]> {
  // The reporting graph is the org's currently-effective reporting lines. A
  // line is effective today when effective_from <= today and effective_to is
  // open or in the future. The exclusion constraint guarantees at most one
  // active line per user, so this is an unambiguous user -> manager map.
  const reportingRows = (await tx.execute(sql`
    SELECT user_id::text AS user_id, manager_id::text AS manager_id
    FROM hr.reporting_lines
    WHERE org_id = ${orgId}
      AND NOT is_deleted
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
  `)) as unknown as Array<{ user_id: string; manager_id: string }>;

  // is_active (global) is still an IAM concern; a manager in the reporting
  // chain who is globally inactive is skipped (does not consume a level).
  const activeRows = (await tx.execute(sql`
    SELECT id::text AS id FROM iam.users WHERE is_active AND NOT is_deleted
  `)) as unknown as Array<{ id: string }>;

  const orgActiveRows = (await tx.execute(sql`
    SELECT user_id::text AS user_id
    FROM iam.user_org_mapping
    WHERE org_id = ${orgId} AND is_active
  `)) as unknown as Array<{ user_id: string }>;

  const fallbackRows = (await tx.execute(sql`
    SELECT uom.user_id::text AS user_id
    FROM iam.user_org_mapping uom
    JOIN iam.user_roles ur ON ur.id = uom.role_id
    WHERE uom.org_id = ${orgId}
      AND uom.is_active
      AND ur.name IN ('org_admin', 'hr_admin')
    ORDER BY uom.user_id ASC
    LIMIT 1
  `)) as unknown as Array<{ user_id: string }>;

  const managerOf = new Map<string, string>(reportingRows.map((r) => [r.user_id, r.manager_id]));
  const globallyActive = new Set(activeRows.map((r) => r.id));
  const orgActive = new Set(orgActiveRows.map((r) => r.user_id));
  const fallbackAdmin = fallbackRows[0]?.user_id ?? null;

  const graph: ApproverGraph = {
    managerOf: (userId) => managerOf.get(userId) ?? null,
    isActiveInOrg: (userId) => globallyActive.has(userId) && orgActive.has(userId),
    fallbackAdmin: () => fallbackAdmin,
  };

  return buildApproverChain(requesterId, levels, graph);
}
