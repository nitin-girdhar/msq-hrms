import { describe, expect, it } from 'vitest';
import { statutoryFieldsSchema, createChangeRequestSchema } from '@hr/validation';
import { changedFields, maskStatutory, maskTail, mergeStatutory, EMPTY_STATUTORY } from '../statutory.js';

describe('maskTail', () => {
  it('keeps the last four characters', () => {
    expect(maskTail('ABCDE1234F')).toBe('••••••234F');
    expect(maskTail('123456789012')).toBe('••••••••9012');
  });
  it('hides short values entirely and tolerates null', () => {
    expect(maskTail('123')).toBe('•••');
    expect(maskTail(null)).toBeNull();
    expect(maskTail('')).toBeNull();
  });
});

describe('maskStatutory', () => {
  it('masks the identifiers but not the bank name or IFSC', () => {
    const m = maskStatutory({ ...EMPTY_STATUTORY, pan: 'ABCDE1234F', account_number: '123456789012', bank_name: 'HDFC', ifsc: 'HDFC0001234' })!;
    expect(m.pan).toBe('••••••234F');
    expect(m.account_number).toBe('••••••••9012');
    expect(m.bank_name).toBe('HDFC');
    expect(m.ifsc).toBe('HDFC0001234');
  });
  it('passes null through', () => {
    expect(maskStatutory(null)).toBeNull();
  });
});

describe('mergeStatutory / changedFields', () => {
  it('leaves absent keys, clears on empty string, replaces otherwise', () => {
    const cur = { ...EMPTY_STATUTORY, pan: 'ABCDE1234F', bank_name: 'Old' };
    const out = mergeStatutory(cur, { bank_name: 'New', pan: '' });
    expect(out.bank_name).toBe('New');
    expect(out.pan).toBeNull();
    expect(mergeStatutory(cur, {}).pan).toBe('ABCDE1234F');
  });
  it('reports only the touched field names', () => {
    expect(changedFields({ pan: '', ifsc: 'HDFC0001234' })).toEqual(['pan', 'ifsc']);
    expect(changedFields({})).toEqual([]);
  });
});

describe('statutoryFieldsSchema', () => {
  it('normalizes case and spacing, then validates formats', () => {
    const r = statutoryFieldsSchema.parse({ pan: 'abcde1234f', aadhaar: '1234 5678 9012', ifsc: 'hdfc0001234', account_number: '1234-5678-90' });
    expect(r).toMatchObject({ pan: 'ABCDE1234F', aadhaar: '123456789012', ifsc: 'HDFC0001234', account_number: '1234567890' });
  });
  it('rejects malformed identifiers with a readable message', () => {
    expect(statutoryFieldsSchema.safeParse({ pan: 'ABC' }).success).toBe(false);
    expect(statutoryFieldsSchema.safeParse({ aadhaar: '12345' }).success).toBe(false);
    expect(statutoryFieldsSchema.safeParse({ ifsc: 'HDFC1001234' }).success).toBe(false);
  });
  it('accepts an empty string to clear a field', () => {
    expect(statutoryFieldsSchema.safeParse({ pan: '', tax_regime: '' }).success).toBe(true);
  });
});

describe('createChangeRequestSchema', () => {
  it('needs at least one field', () => {
    expect(createChangeRequestSchema.safeParse({ payload: {} }).success).toBe(false);
    expect(createChangeRequestSchema.safeParse({ payload: { bank_name: 'HDFC' } }).success).toBe(true);
  });
});
