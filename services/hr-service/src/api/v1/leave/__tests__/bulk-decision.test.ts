import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkLeaveDecisionSchema } from '@hr/validation';

// The service module reads config + builds a logger + talks to the repository at
// import time; stub those so the test exercises only the bulk loop itself.
vi.mock('../../../../config/index.js', () => ({ config: { nodeEnv: 'test', logLevel: 'silent' } }));
vi.mock('@platform/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock('@platform/audit-log', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('../../../../lib/events.js', () => ({ publishLeaveEvent: vi.fn(async () => undefined) }));
vi.mock('@hr/authz', () => ({
  canManageLeave: vi.fn(),
  canOverrideLeaveApproval: vi.fn(() => false),
  isTenantLeaveAdmin: vi.fn(),
}));
vi.mock('../leave.repository.js', () => ({
  approveLeave: vi.fn(),
  rejectLeave: vi.fn(),
}));

import * as repo from '../leave.repository.js';
import { NotFoundError } from '../../../../lib/errors.js';
import { bulkDecideLeave } from '../leave.service.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ctx = { org_id: 'o', user_id: 'u', role: 'r', tenant_id: 't', rank: 1, capabilities: [], readOnly: false } as never;
const approved = (id: string) => ({ request_id: id, requester_id: 'req', org_id: 'o', final: true, next_approver_id: null });

describe('bulkLeaveDecisionSchema', () => {
  it('requires a comment to reject, not to approve', () => {
    expect(bulkLeaveDecisionSchema.safeParse({ request_ids: [A], decision: 'reject' }).success).toBe(false);
    expect(bulkLeaveDecisionSchema.safeParse({ request_ids: [A], decision: 'reject', comment: '   ' }).success).toBe(false);
    expect(bulkLeaveDecisionSchema.safeParse({ request_ids: [A], decision: 'reject', comment: 'No cover' }).success).toBe(true);
    expect(bulkLeaveDecisionSchema.safeParse({ request_ids: [A], decision: 'approve' }).success).toBe(true);
  });

  it('bounds the batch', () => {
    expect(bulkLeaveDecisionSchema.safeParse({ request_ids: [], decision: 'approve' }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(bulkLeaveDecisionSchema.safeParse({ request_ids: many, decision: 'approve' }).success).toBe(false);
  });
});

describe('bulkDecideLeave', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips a request that fails and still applies the rest', async () => {
    vi.mocked(repo.approveLeave).mockImplementation(async (_c, id) => {
      if (id === B) throw new NotFoundError('Leave request not found');
      return approved(id) as never;
    });
    const out = await bulkDecideLeave(ctx, { request_ids: [A, B], decision: 'approve' });
    expect(out).toMatchObject({ requested: 2, succeeded: 1, failed: 1 });
    expect(out.results).toEqual([
      { request_id: A, ok: true },
      { request_id: B, ok: false, error: 'Leave request not found' },
    ]);
  });

  it('de-duplicates ids and never leaks an unexpected error message', async () => {
    vi.mocked(repo.rejectLeave).mockRejectedValue(new Error('connection string postgres://secret'));
    const out = await bulkDecideLeave(ctx, { request_ids: [A, A], decision: 'reject', comment: 'No cover' });
    expect(out.requested).toBe(1);
    expect(out.results[0]).toEqual({ request_id: A, ok: false, error: 'This request could not be decided' });
  });
});
