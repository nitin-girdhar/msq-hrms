import { describe, it, expect } from 'vitest';
import { assertKeyInTenant, blobKeys, isLegacyKey, tenantOfKey } from '@platform/blob-storage';

const T = '0198f3a0-0000-7000-8000-000000000001';
const T2 = '0198f3a0-0000-7000-8000-000000000002';
const B = '0198f3a0-0000-7000-8000-0000000000b1';
const E = '0198f3a0-0000-7000-8000-0000000000e1';

describe('blobKeys', () => {
  it('builds the tenant-first hierarchy', () => {
    expect(blobKeys.brand(T, 'logo', 'PNG', 1700000000000)).toBe(`${T}/branding/logo/1700000000000.png`);
    expect(blobKeys.avatar(T, B, E, 'jpg', 1700000000000)).toBe(`${T}/${B}/${E}/avatar/1700000000000.jpg`);
    expect(blobKeys.punch(T, B, E, { date: '20260705', kind: 'chkin', n: 2, ext: 'jpg' })).toBe(
      `${T}/${B}/${E}/punches/2026/07/20260705_chkin_2.jpg`,
    );
    expect(blobKeys.platformBrand('mark', 'png')).toBe('_platform/branding/mark.png');
  });

  it('rejects anything that is not a lower-case UUID / whitelisted segment', () => {
    expect(() => blobKeys.brand('../x', 'logo', 'png')).toThrow();
    expect(() => blobKeys.brand(T.toUpperCase(), 'logo', 'png')).toThrow();
    expect(() => blobKeys.brand(T, 'logo/../x', 'png')).toThrow();
    expect(() => blobKeys.brand(T, 'logo', 'p/g')).toThrow();
    expect(() => blobKeys.avatar(T, B, 'not-a-uuid', 'jpg')).toThrow();
    expect(() => blobKeys.punch(T, B, E, { date: '20261301', kind: 'chkin', n: 1, ext: 'jpg' })).toThrow();
    expect(() => blobKeys.punch(T, B, E, { date: '20260105', kind: 'chkin', n: 0, ext: 'jpg' })).toThrow();
  });
});

describe('assertKeyInTenant', () => {
  const key = blobKeys.avatar(T, B, E, 'jpg', 1700000000000);

  it('accepts the caller\'s own tenant and rejects another tenant', () => {
    expect(() => assertKeyInTenant(key, T)).not.toThrow();
    expect(() => assertKeyInTenant(key, T2)).toThrow(/another tenant/);
  });

  it('rejects _platform keys unless explicitly allowed', () => {
    expect(() => assertKeyInTenant('_platform/branding/mark.png', T)).toThrow();
    expect(() => assertKeyInTenant('_platform/branding/mark.png', T, { allowPlatform: true })).not.toThrow();
  });

  it('handles legacy keys: opt-in, and brand/<tenant> is still verified', () => {
    expect(isLegacyKey('avatar/u/1.jpg')).toBe(true);
    expect(() => assertKeyInTenant('avatar/u/1.jpg', T)).toThrow(/Legacy/);
    expect(() => assertKeyInTenant('avatar/u/1.jpg', T, { allowLegacy: true })).not.toThrow();
    expect(() => assertKeyInTenant(`brand/${T}/logo/1.png`, T, { allowLegacy: true })).not.toThrow();
    expect(() => assertKeyInTenant(`brand/${T2}/logo/1.png`, T, { allowLegacy: true })).toThrow(/another tenant/);
  });

  it('tenantOfKey only reads a UUID first segment', () => {
    expect(tenantOfKey(key)).toBe(T);
    expect(tenantOfKey('punch/u/20260101_chkin_1.jpg')).toBeNull();
  });
});
