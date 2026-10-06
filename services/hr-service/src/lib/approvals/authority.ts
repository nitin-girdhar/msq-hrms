// ─────────────────────────────────────────────────────────────────────────────
// Who may decide the next level of a multi-level approval — one rule for leave
// and attendance regularization, kept pure so every case is unit-testable.
//
// An approval always acts on the LOWEST pending level. The actor may decide it if:
//   - they are its assigned approver, or
//   - they are the assigned approver of a HIGHER pending level and are covering the
//     lower one on its approver's behalf, or
//   - they hold the admin override (hr_admin / org_admin / tenant_admin).
// Nobody approves two levels: whoever already approved one (as themselves or on
// someone's behalf) is refused. A non-admin cannot act on a level above their own.
//
// After a cover, the covering person's OWN level still needs an approver, and they
// can no longer be it — `rowsNeedingReplacement` names those rows so the caller can
// hand them to the next manager up, or escalate.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChainRow {
  id: string;
  level: number;
  approver_id: string;
  action: 'pending' | 'approved' | 'rejected';
  acted_by: string | null;
}

export type Authority =
  | { ok: true; pending: ChainRow; covering: boolean }
  | { ok: false; reason: string };

export const ALREADY_APPROVED_REASON =
  'You have already approved a level of this request; a different approver must approve the next level';

export function decisionAuthority(
  rows: ChainRow[],
  actorId: string,
  isOverride: boolean,
  // A rejection ends the request, so someone who already approved a lower level may still reject.
  action: 'approve' | 'reject' = 'approve',
): Authority {
  const pending = rows
    .filter((r) => r.action === 'pending')
    .sort((a, b) => a.level - b.level)[0];
  if (!pending) return { ok: false, reason: 'No pending approval level for this request' };

  if (action === 'approve' && rows.some((r) => r.action === 'approved' && (r.acted_by ?? r.approver_id) === actorId)) {
    return { ok: false, reason: ALREADY_APPROVED_REASON };
  }

  const assigned = pending.approver_id === actorId;
  const assignedAbove = rows.some((r) => r.action === 'pending' && r.level > pending.level && r.approver_id === actorId);
  if (!assigned && !assignedAbove && !isOverride) {
    return { ok: false, reason: 'You are not the approver for this level' };
  }
  return { ok: true, pending, covering: !assigned };
}

/**
 * Pending rows still assigned to the person who just approved. They have acted, so
 * they cannot take these levels; each needs a new approver.
 */
export function rowsNeedingReplacement(rows: ChainRow[], actorId: string, decidedRowId: string): ChainRow[] {
  return rows.filter((r) => r.id !== decidedRowId && r.action === 'pending' && r.approver_id === actorId);
}
