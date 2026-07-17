// ─────────────────────────────────────────────────────────────────────────────
// Approver-chain resolution.
//
// The org's approval chain walks iam.users.manager_id upward `levels` steps.
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
// org's user graph in two queries and hands it to the pure function.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import type { DrizzleTx } from '@crm/db';

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

interface UserRow {
  id: string;
  manager_id: string | null;
  is_active: boolean;
}

/**
 * DB-backed approver resolution. Pre-fetches the tenant's user graph and the
 * org's active-membership set, then delegates to `buildApproverChain`.
 */
export async function resolveApprovers(
  tx: DrizzleTx,
  orgId: string,
  requesterId: string,
  levels: number,
): Promise<ApproverAssignment[]> {
  // manager_id chain may traverse users who are not org-active (they get
  // skipped but we still need their manager_id), so load the full user graph.
  const userRows = (await tx.execute(sql`
    SELECT id::text AS id, manager_id::text AS manager_id, is_active
    FROM iam.users
  `)) as unknown as UserRow[];

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

  const byId = new Map<string, UserRow>(userRows.map((u) => [u.id, u]));
  const orgActive = new Set(orgActiveRows.map((r) => r.user_id));
  const fallbackAdmin = fallbackRows[0]?.user_id ?? null;

  const graph: ApproverGraph = {
    managerOf: (userId) => byId.get(userId)?.manager_id ?? null,
    isActiveInOrg: (userId) => {
      const u = byId.get(userId);
      return !!u && u.is_active && orgActive.has(userId);
    },
    fallbackAdmin: () => fallbackAdmin,
  };

  return buildApproverChain(requesterId, levels, graph);
}
