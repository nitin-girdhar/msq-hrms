import { describe, expect, it } from 'vitest';
import { decisionAuthority, rowsNeedingReplacement, ALREADY_APPROVED_REASON, type ChainRow } from '../authority.js';
import { pickReplacementApprover } from '../../leave/resolve-approvers.js';

const row = (level: number, approver: string, action: ChainRow['action'] = 'pending', actedBy: string | null = null): ChainRow =>
  ({ id: `r${level}`, level, approver_id: approver, action, acted_by: actedBy });

describe('decisionAuthority', () => {
  const chain = [row(1, 'm1'), row(2, 'm2')];

  it('lets the assigned approver of the lowest pending level decide', () => {
    expect(decisionAuthority(chain, 'm1', false)).toMatchObject({ ok: true, covering: false });
  });

  it('lets a higher approver cover the lowest pending level', () => {
    const r = decisionAuthority(chain, 'm2', false);
    expect(r).toMatchObject({ ok: true, covering: true });
    expect(r.ok && r.pending.level).toBe(1);
  });

  it('refuses a stranger and a lower approver acting above their level', () => {
    expect(decisionAuthority(chain, 'x', false)).toEqual({ ok: false, reason: 'You are not the approver for this level' });
    // m1 is level 1; once level 1 is done they are not assigned to level 2.
    expect(decisionAuthority([row(1, 'm1', 'approved', 'm1'), row(2, 'm2')], 'm1', false).ok).toBe(false);
  });

  it('lets an admin override act on any level', () => {
    expect(decisionAuthority(chain, 'admin', true)).toMatchObject({ ok: true, covering: true });
  });

  it('never lets the same person approve two levels', () => {
    // m2 covered level 1; their own level 2 is still assigned to them.
    const afterCover = [row(1, 'm1', 'approved', 'm2'), row(2, 'm2')];
    expect(decisionAuthority(afterCover, 'm2', false)).toEqual({ ok: false, reason: ALREADY_APPROVED_REASON });
    // An admin who overrode level 1 cannot also override level 2.
    const adminDid1 = [row(1, 'm1', 'approved', 'admin'), row(2, 'm2')];
    expect(decisionAuthority(adminDid1, 'admin', true)).toEqual({ ok: false, reason: ALREADY_APPROVED_REASON });
  });

  it('falls back to the designated approver for rows from before acted_by existed', () => {
    expect(decisionAuthority([row(1, 'm1', 'approved'), row(2, 'm2')], 'm1', true).ok).toBe(false);
  });

  it('still lets someone who approved a lower level reject', () => {
    const afterCover = [row(1, 'm1', 'approved', 'm2'), row(2, 'm2')];
    expect(decisionAuthority(afterCover, 'm2', false, 'reject')).toMatchObject({ ok: true });
  });

  it('reports a request with nothing pending', () => {
    expect(decisionAuthority([row(1, 'm1', 'approved', 'm1')], 'm1', true).ok).toBe(false);
  });
});

describe('rowsNeedingReplacement', () => {
  it('names the pending levels still assigned to the person who just approved', () => {
    const rows = [row(1, 'm1', 'approved', 'm2'), row(2, 'm2'), row(3, 'm3')];
    expect(rowsNeedingReplacement(rows, 'm2', 'r1').map((r) => r.id)).toEqual(['r2']);
  });

  it('is empty when the approver held only the level they decided', () => {
    expect(rowsNeedingReplacement([row(1, 'm1', 'approved', 'm1'), row(2, 'm2')], 'm1', 'r1')).toEqual([]);
  });
});

describe('pickReplacementApprover', () => {
  const up: Record<string, string> = { m2: 'm3', m3: 'm4' };
  const graph = (inactive: string[] = []) => ({
    managerOf: (id: string) => up[id] ?? null,
    isActiveInOrg: (id: string) => !inactive.includes(id),
  });

  it('takes the next manager above the person who covered', () => {
    expect(pickReplacementApprover('m2', new Set(['req', 'm1', 'm2']), graph())).toBe('m3');
  });

  it('skips managers already in the chain and inactive ones', () => {
    expect(pickReplacementApprover('m2', new Set(['m3']), graph())).toBe('m4');
    expect(pickReplacementApprover('m2', new Set(), graph(['m3']))).toBe('m4');
  });

  it('returns null when the chain runs out, so the caller escalates to admins', () => {
    expect(pickReplacementApprover('m2', new Set(['m3', 'm4']), graph())).toBeNull();
    expect(pickReplacementApprover('m4', new Set(), graph())).toBeNull();
  });
});
