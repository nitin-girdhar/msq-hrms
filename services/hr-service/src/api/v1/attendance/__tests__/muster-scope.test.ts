import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttendanceCtx } from '../attendance.repository';

// The service decides which branches the muster sheet reads; the repository is
// mocked so these assert only that decision — never a client-picked branch list.
vi.mock('../attendance.repository', () => ({
  tenantBranches: vi.fn(),
  reportMuster: vi.fn(),
  monthlySummary: vi.fn(),
  reportDetail: vi.fn(),
}));

const repo = await import('../attendance.repository');
const { musterReport, monthlySummary } = await import('../attendance.service');

const BRANCHES = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Sector 49' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Sector 57' },
];
const HOME = BRANCHES[1]!.id;

function ctx(capabilities: string[]): AttendanceCtx {
  return {
    org_id: HOME, user_id: 'u1', tenant_id: 't1', role: 'member', rank: 75, capabilities,
  } as AttendanceCtx;
}
const VIEW = 'hr.reports.attendance.view';
const ORG = ctx([VIEW, `${VIEW}.org`]);
const TENANT = ctx([VIEW, `${VIEW}.org`, `${VIEW}.tenant`]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.tenantBranches).mockResolvedValue(BRANCHES);
  vi.mocked(repo.reportMuster).mockResolvedValue([]);
  vi.mocked(repo.monthlySummary).mockResolvedValue([]);
});

describe('musterReport branch scope', () => {
  it('branch=current reads only the session branch', async () => {
    const r = await musterReport(ORG, '2026-09', { branch: 'current' });
    expect(repo.reportMuster).toHaveBeenCalledWith(ORG, '2026-09', [HOME]);
    expect(r.scope_label).toBe('Sector 57');
  });

  it('branch=all without the tenant scope is refused', async () => {
    await expect(musterReport(ORG, '2026-09', { branch: 'all' })).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.reportMuster).not.toHaveBeenCalled();
  });

  it('branch=all with the tenant scope reads every branch of the tenant', async () => {
    const r = await musterReport(TENANT, '2026-09', { branch: 'all' });
    expect(repo.reportMuster).toHaveBeenCalledWith(TENANT, '2026-09', BRANCHES.map((b) => b.id));
    expect(r.scope_label).toBe('All branches');
  });

  it('org_id narrows to one branch of the tenant', async () => {
    await musterReport(TENANT, '2026-09', { branch: 'all', org_id: BRANCHES[0]!.id });
    expect(repo.reportMuster).toHaveBeenCalledWith(TENANT, '2026-09', [BRANCHES[0]!.id]);
  });

  it('an org_id outside the tenant is a 403, not an empty sheet', async () => {
    const foreign = '99999999-9999-4999-8999-999999999999';
    await expect(musterReport(TENANT, '2026-09', { branch: 'all', org_id: foreign })).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.reportMuster).not.toHaveBeenCalled();
  });

  it('branch=current cannot be pointed at another branch', async () => {
    await expect(musterReport(ORG, '2026-09', { branch: 'current', org_id: BRANCHES[0]!.id })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('holding the operation with no scope is refused', async () => {
    await expect(musterReport(ctx([VIEW]), '2026-09', { branch: 'current' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(monthlySummary(ctx([VIEW]), '2026-09')).rejects.toMatchObject({ statusCode: 403 });
  });
});
