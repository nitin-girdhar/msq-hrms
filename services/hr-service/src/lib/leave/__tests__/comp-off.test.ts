import { describe, expect, it } from 'vitest';
import {
  COMP_OFF_MAX_BACKDATE_DAYS,
  addDaysIso,
  checkClaimDate,
  daysBetweenIso,
  lapseAmount,
  weekdayOf,
} from '../comp-off.js';

// 2026-10-04 is a Sunday; 2026-10-05 a Monday.
const TODAY = '2026-10-07';

describe('date helpers', () => {
  it('numbers weekdays from Sunday', () => {
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2026-10-05')).toBe(1);
  });
  it('adds and measures whole days across a month end', () => {
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02');
    expect(daysBetweenIso('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetweenIso('2026-10-31', '2026-10-01')).toBe(-30);
  });
});

describe('checkClaimDate', () => {
  const base = { today: TODAY, weeklyOff: [0, 6], holidays: [] as string[] };

  it('accepts a past weekly off', () => {
    expect(checkClaimDate({ ...base, workedDate: '2026-10-04' })).toEqual({ ok: true });
  });
  it('accepts a past holiday that falls on a working weekday', () => {
    expect(checkClaimDate({ ...base, workedDate: '2026-10-05', holidays: ['2026-10-05'] })).toEqual({ ok: true });
  });
  it('rejects an ordinary working day', () => {
    const v = checkClaimDate({ ...base, workedDate: '2026-10-05' });
    expect(v.ok).toBe(false);
  });
  it('rejects a future day', () => {
    const v = checkClaimDate({ ...base, workedDate: '2026-10-11' });
    expect(v).toMatchObject({ ok: false });
  });
  it('rejects work older than the backdate window, accepts the boundary', () => {
    // 2026-10-07 minus 60 days = 2026-08-08, a Saturday (weekly off).
    expect(checkClaimDate({ ...base, workedDate: '2026-08-08' })).toEqual({ ok: true });
    // One day further back is a Friday: out of the window.
    const old = checkClaimDate({ ...base, workedDate: '2026-08-07' });
    expect(old.ok).toBe(false);
    expect(daysBetweenIso('2026-08-08', TODAY)).toBe(COMP_OFF_MAX_BACKDATE_DAYS);
  });
  it('honours a non-default weekly off', () => {
    // A Friday/Saturday weekend.
    expect(checkClaimDate({ ...base, weeklyOff: [5, 6], workedDate: '2026-10-02' })).toEqual({ ok: true });
    expect(checkClaimDate({ ...base, weeklyOff: [5, 6], workedDate: '2026-10-04' }).ok).toBe(false);
  });
});

describe('lapseAmount', () => {
  it('lapses the whole credit when the balance covers it', () => {
    expect(lapseAmount(1, 3)).toBe(1);
  });
  it('lapses only what is left when some was spent', () => {
    expect(lapseAmount(1, 0.5)).toBe(0.5);
  });
  it('never lapses below zero', () => {
    expect(lapseAmount(1, 0)).toBe(0);
    expect(lapseAmount(1, -2)).toBe(0);
  });
});
