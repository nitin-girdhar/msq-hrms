import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { syncEmployeeProfileSchema } from '../internal.schema.js';

// internal.auth.ts reads the secret at module load, so it is set before the
// dynamic import below.
let authenticateInternal: (request: FastifyRequest) => Promise<void>;
beforeAll(async () => {
  process.env['INTERNAL_SERVICE_SECRET'] = 'test-secret';
  ({ authenticateInternal } = await import('../internal.auth.js'));
});

const req = (secret?: string) =>
  ({ headers: secret === undefined ? {} : { 'x-internal-secret': secret } }) as unknown as FastifyRequest;

describe('authenticateInternal', () => {
  it('rejects a call with no secret', async () => {
    await expect(authenticateInternal(req())).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a wrong secret', async () => {
    await expect(authenticateInternal(req('nope'))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('accepts the shared secret', async () => {
    await expect(authenticateInternal(req('test-secret'))).resolves.toBeUndefined();
  });
});

describe('syncEmployeeProfileSchema', () => {
  const valid = {
    user_id: '0190a0a0-0000-7000-8000-000000000001',
    tenant_id: '0190a0a0-0000-7000-8000-000000000002',
    home_org_id: '0190a0a0-0000-7000-8000-000000000003',
    is_active: true,
    actor_id: '0190a0a0-0000-7000-8000-000000000004',
  };

  it('accepts a body without a joining date', () => {
    expect(syncEmployeeProfileSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a YYYY-MM-DD joining date', () => {
    expect(syncEmployeeProfileSchema.safeParse({ ...valid, date_of_joining: '2026-09-27' }).success).toBe(true);
  });

  it('rejects a malformed joining date', () => {
    expect(syncEmployeeProfileSchema.safeParse({ ...valid, date_of_joining: '27/09/2026' }).success).toBe(false);
  });

  it('rejects a non-uuid home branch', () => {
    expect(syncEmployeeProfileSchema.safeParse({ ...valid, home_org_id: 'branch-1' }).success).toBe(false);
  });
});
