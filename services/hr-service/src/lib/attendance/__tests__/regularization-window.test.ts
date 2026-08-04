import { describe, it, expect } from 'vitest';
import { regularizationWindow, regularizationWindowError } from '../regularization-window.js';

const IST = 'Asia/Kolkata'; // UTC+5:30, no DST
const NY = 'America/New_York';

// A fixed instant so "today" never depends on when the suite runs.
// 2026-07-15T06:00:00Z = 11:30 IST on the 15th, 02:00 EDT on the 15th.
const NOON_ISH = new Date('2026-07-15T06:00:00Z');

function rules(days: number, timezone = IST) {
  return { timezone, regularization_max_backdate_days: days };
}

describe('regularizationWindow', () => {
  it('spans today back N days, inclusive at both ends', () => {
    expect(regularizationWindow(rules(30), NOON_ISH)).toEqual({
      earliest: '2026-06-15',
      latest: '2026-07-15',
    });
  });

  it('collapses to a single day when the window is 0', () => {
    const w = regularizationWindow(rules(0), NOON_ISH);
    expect(w.earliest).toBe(w.latest);
    expect(w.latest).toBe('2026-07-15');
  });

  it('crosses a month boundary by calendar days, not by 30-day arithmetic', () => {
    // 2026-03-05 minus 7 days lands in February, whose length varies.
    expect(regularizationWindow(rules(7), new Date('2026-03-05T06:00:00Z')).earliest)
      .toBe('2026-02-26');
  });
});

describe('regularizationWindowError — boundaries', () => {
  it('accepts today', () => {
    expect(regularizationWindowError('2026-07-15', rules(30), NOON_ISH)).toBeNull();
  });

  it('accepts the oldest day in the window (today - N)', () => {
    expect(regularizationWindowError('2026-06-15', rules(30), NOON_ISH)).toBeNull();
  });

  it('rejects the day just outside the window (today - N - 1)', () => {
    const err = regularizationWindowError('2026-06-14', rules(30), NOON_ISH);
    expect(err).toContain('last 30 day(s)');
    expect(err).toContain('2026-06-15');
  });

  it('rejects tomorrow, and says so as a future date rather than a window miss', () => {
    expect(regularizationWindowError('2026-07-16', rules(30), NOON_ISH))
      .toBe('A regularization cannot be filed for a future date.');
  });

  it('rejects a future date even when the backdate window is wide open', () => {
    expect(regularizationWindowError('2026-07-16', rules(365), NOON_ISH))
      .toBe('A regularization cannot be filed for a future date.');
  });
});

describe('regularizationWindowError — window of 0 means today only', () => {
  it('accepts today', () => {
    expect(regularizationWindowError('2026-07-15', rules(0), NOON_ISH)).toBeNull();
  });

  it('rejects yesterday with the today-only wording', () => {
    expect(regularizationWindowError('2026-07-14', rules(0), NOON_ISH))
      .toBe('Regularizations are only accepted for today (2026-07-15).');
  });
});

describe('regularizationWindowError — "today" is the ORG day, not the UTC day', () => {
  // The bug this guards: during the UTC+ evening window the org-local date is
  // already tomorrow relative to UTC, so a same-day request filed at 00:30 IST
  // would be rejected as "future" if today were computed in UTC.
  const LATE_UTC = new Date('2026-07-14T19:00:00Z'); // 2026-07-15 00:30 IST

  it('accepts the org-local today that UTC still calls tomorrow', () => {
    expect(regularizationWindowError('2026-07-15', rules(30), LATE_UTC)).toBeNull();
  });

  it('shifts the whole window with the org day', () => {
    expect(regularizationWindow(rules(7), LATE_UTC)).toEqual({
      earliest: '2026-07-08',
      latest: '2026-07-15',
    });
  });

  it('is still the previous day in a UTC- zone at the same instant', () => {
    // 19:00Z = 15:00 EDT on the 14th, so the 15th is genuinely future there.
    expect(regularizationWindowError('2026-07-15', rules(30, NY), LATE_UTC))
      .toBe('A regularization cannot be filed for a future date.');
    expect(regularizationWindowError('2026-07-14', rules(30, NY), LATE_UTC)).toBeNull();
  });
});
