// ─────────────────────────────────────────────────────────────────────────────
// The validation contract for geofence exceptions — the exact payloads the
// admin UI sends to POST|PATCH /hr/geo-exceptions.
//
// Like validation.e2e.test.ts, this lives in hr-service (which has the test
// runner) and imports @hr/validation by name, so what is exercised is the built
// contract the service actually consumes. Run `pnpm --filter @hr/validation
// build` first if the schemas changed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { createGeoExceptionSchema, updateGeoExceptionSchema } from '@hr/validation';

const USER = '11111111-1111-4111-8111-111111111111';

const BASE = {
  user_id: USER,
  exception_type: 'remote_role' as const,
  effective_from: '2026-08-01',
  reason: 'Rotating field role — north territory',
};

describe('createGeoExceptionSchema', () => {
  it('accepts an open-ended remote-role exception', () => {
    const parsed = createGeoExceptionSchema.parse(BASE);
    expect(parsed.exception_type).toBe('remote_role');
    expect(parsed.effective_to).toBeUndefined();
  });

  it('accepts a date-bounded WFH exception', () => {
    const parsed = createGeoExceptionSchema.parse({
      ...BASE,
      exception_type: 'wfh',
      effective_to: '2026-09-30',
      reason: 'Approved work from home while relocating',
    });
    expect(parsed.exception_type).toBe('wfh');
    expect(parsed.effective_to).toBe('2026-09-30');
  });

  it('accepts an explicit null end date as open-ended', () => {
    expect(createGeoExceptionSchema.parse({ ...BASE, effective_to: null }).effective_to).toBeNull();
  });

  // Mirrors the DB CHECK: anything else would be stored and then never matched
  // by the punch-time lookup, silently doing nothing.
  it('rejects an unknown exception type', () => {
    expect(createGeoExceptionSchema.safeParse({ ...BASE, exception_type: 'field' }).success).toBe(false);
  });

  // A reason is required, not optional — this record has to explain itself later
  // to whoever asks why the person's attendance was never location-checked.
  it('rejects a missing, blank or too-short reason', () => {
    for (const reason of [undefined, '', '  ', 'ab']) {
      expect(createGeoExceptionSchema.safeParse({ ...BASE, reason }).success).toBe(false);
    }
  });

  it('trims the reason before length checking it', () => {
    expect(createGeoExceptionSchema.parse({ ...BASE, reason: '  field role  ' }).reason).toBe('field role');
  });

  it('rejects a reason over 500 characters', () => {
    expect(createGeoExceptionSchema.safeParse({ ...BASE, reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects a non-ISO date', () => {
    expect(createGeoExceptionSchema.safeParse({ ...BASE, effective_from: '01-08-2026' }).success).toBe(false);
  });

  it('rejects a non-uuid user', () => {
    expect(createGeoExceptionSchema.safeParse({ ...BASE, user_id: 'nitin' }).success).toBe(false);
  });
});

describe('updateGeoExceptionSchema', () => {
  it('accepts ending an exception by setting only the end date', () => {
    expect(updateGeoExceptionSchema.parse({ effective_to: '2026-08-05' }).effective_to).toBe('2026-08-05');
  });

  it('accepts reopening an exception by nulling the end date', () => {
    expect(updateGeoExceptionSchema.parse({ effective_to: null }).effective_to).toBeNull();
  });

  // Deliberately not updatable: changing the kind would rewrite the recorded
  // reason for punches already made under this row. Zod strips it silently, so
  // assert it never reaches the repository as an update.
  it('does not carry exception_type through', () => {
    expect(updateGeoExceptionSchema.parse({ exception_type: 'wfh' })).not.toHaveProperty('exception_type');
  });

  it('rejects a blank reason on update', () => {
    expect(updateGeoExceptionSchema.safeParse({ reason: ' ' }).success).toBe(false);
  });
});
