import { describe, expect, it } from 'vitest';
import { checkEncashment } from '../encashment.js';

const ok = { encashable: true, maxEncashDays: 10 };

describe('checkEncashment', () => {
  it('accepts a request within cap and balance', () => {
    expect(checkEncashment({ policy: ok, days: 5, balance: 12 })).toEqual({ ok: true });
  });
  it('refuses when there is no policy or the type is not encashable', () => {
    expect(checkEncashment({ policy: null, days: 1, balance: 5 }).ok).toBe(false);
    expect(checkEncashment({ policy: { encashable: false, maxEncashDays: null }, days: 1, balance: 5 }).ok).toBe(false);
  });
  it('refuses zero, negative and quarter days', () => {
    for (const days of [0, -1, 1.25]) expect(checkEncashment({ policy: ok, days, balance: 20 }).ok).toBe(false);
  });
  it('accepts half days', () => {
    expect(checkEncashment({ policy: ok, days: 2.5, balance: 20 })).toEqual({ ok: true });
  });
  it('enforces the per-request cap, accepting exactly the cap', () => {
    expect(checkEncashment({ policy: ok, days: 11, balance: 40 }).ok).toBe(false);
    expect(checkEncashment({ policy: ok, days: 10, balance: 40 }).ok).toBe(true);
  });
  it('has no cap when max is null', () => {
    expect(checkEncashment({ policy: { encashable: true, maxEncashDays: null }, days: 30, balance: 30 }).ok).toBe(true);
  });
  it('refuses more than the balance, and counts other pending requests against it', () => {
    expect(checkEncashment({ policy: ok, days: 6, balance: 5 }).ok).toBe(false);
    const v = checkEncashment({ policy: ok, days: 4, balance: 8, alreadyPending: 6 });
    expect(v).toMatchObject({ ok: false });
    expect((v as { reason: string }).reason).toContain('2');
  });
});
