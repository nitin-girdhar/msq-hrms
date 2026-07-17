import { describe, it, expect } from 'vitest';
import { buildApproverChain, type ApproverGraph } from '../resolve-approvers';

/** Build a mock graph from a manager map + active set + fallback. */
function makeGraph(
  managers: Record<string, string | null>,
  active: Set<string>,
  fallback: string | null = null,
): ApproverGraph {
  return {
    managerOf: (id) => managers[id] ?? null,
    isActiveInOrg: (id) => active.has(id),
    fallbackAdmin: () => fallback,
  };
}

describe('buildApproverChain', () => {
  it('resolves a straight 2-level manager chain', () => {
    const graph = makeGraph(
      { emp: 'mgr', mgr: 'dir', dir: null },
      new Set(['emp', 'mgr', 'dir']),
    );
    expect(buildApproverChain('emp', 2, graph)).toEqual([
      { level: 1, approverId: 'mgr' },
      { level: 2, approverId: 'dir' },
    ]);
  });

  it('skips an inactive manager and keeps walking up (skip does not consume a level)', () => {
    const graph = makeGraph(
      { emp: 'mgr', mgr: 'dir', dir: 'vp', vp: null },
      // mgr is inactive → skipped; dir + vp fill the two levels
      new Set(['emp', 'dir', 'vp']),
    );
    expect(buildApproverChain('emp', 2, graph)).toEqual([
      { level: 1, approverId: 'dir' },
      { level: 2, approverId: 'vp' },
    ]);
  });

  it('terminates at the last resolvable manager when the chain is shorter than levels (no padding)', () => {
    const graph = makeGraph(
      { emp: 'mgr', mgr: null },
      new Set(['emp', 'mgr']),
    );
    // Requested 3 levels but only one manager exists → single level, no dupes.
    expect(buildApproverChain('emp', 3, graph)).toEqual([{ level: 1, approverId: 'mgr' }]);
  });

  it('falls back to a deterministic admin when the requester has no resolvable manager', () => {
    const graph = makeGraph(
      { emp: null },
      new Set(['emp']),
      'hradmin',
    );
    expect(buildApproverChain('emp', 2, graph)).toEqual([{ level: 1, approverId: 'hradmin' }]);
  });

  it('falls back when every manager in the chain is inactive', () => {
    const graph = makeGraph(
      { emp: 'mgr', mgr: 'dir', dir: null },
      new Set(['emp']), // no manager is org-active
      'orgadmin',
    );
    expect(buildApproverChain('emp', 2, graph)).toEqual([{ level: 1, approverId: 'orgadmin' }]);
  });

  it('never places the same person at two levels (dedupe on cycle)', () => {
    const graph = makeGraph(
      // pathological cycle mgr -> dir -> mgr
      { emp: 'mgr', mgr: 'dir', dir: 'mgr' },
      new Set(['emp', 'mgr', 'dir']),
    );
    expect(buildApproverChain('emp', 3, graph)).toEqual([
      { level: 1, approverId: 'mgr' },
      { level: 2, approverId: 'dir' },
    ]);
  });

  it('returns no approvers when there is no manager and no fallback admin', () => {
    const graph = makeGraph({ emp: null }, new Set(['emp']), null);
    expect(buildApproverChain('emp', 1, graph)).toEqual([]);
  });

  it('does not let the fallback admin approve their own request', () => {
    const graph = makeGraph({ emp: null }, new Set(['emp']), 'emp');
    expect(buildApproverChain('emp', 1, graph)).toEqual([]);
  });
});
