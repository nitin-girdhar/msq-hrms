import { describe, it, expect } from 'vitest';
import {
  resolveEventStatus,
  thresholdsFrom,
  summarizeSessions,
  DEFAULT_THRESHOLDS,
  type ShiftThresholds,
  type SessionEvent,
} from '../resolve';

const STD: ShiftThresholds = { minHalfDayMinutes: 240, minFullDayMinutes: 480 };

// Helper: build a punch at an ISO instant on a fixed UTC day.
const at = (hhmm: string, event_type: 'check_in' | 'check_out'): SessionEvent => ({
  occurred_at: `2026-07-28T${hhmm}:00.000Z`,
  event_type,
});

describe('resolveEventStatus — three-way classification', () => {
  it('marks a 2-minute day ABSENT, not half day', () => {
    // The reported bug: min_half_day_minutes was never compared against anything,
    // so any checked-out day below a full day became 'half_day' — including a
    // 12:01am–12:04am session.
    expect(resolveEventStatus(2, STD)).toBe('absent');
  });

  it('classifies each threshold boundary', () => {
    const cases: Array<[number, string]> = [
      [0, 'absent'],
      [1, 'absent'],
      [239, 'absent'],
      [240, 'half_day'],
      [241, 'half_day'],
      [479, 'half_day'],
      [480, 'present'],
      [481, 'present'],
    ];
    for (const [minutes, expected] of cases) {
      expect(resolveEventStatus(minutes, STD), `${minutes} minutes`).toBe(expected);
    }
  });

  it('treats a day still in progress (no check-out) as tentatively present', () => {
    // workedMinutes === null means "checked in, not out yet" — never absent, or
    // an employee mid-shift would flip to absent until they punched out.
    expect(resolveEventStatus(null, STD)).toBe('present');
    expect(resolveEventStatus(null, { minHalfDayMinutes: 0, minFullDayMinutes: 0 })).toBe('present');
  });

  it('honours custom thresholds rather than the constants', () => {
    const short: ShiftThresholds = { minHalfDayMinutes: 120, minFullDayMinutes: 240 };
    expect(resolveEventStatus(119, short)).toBe('absent');
    expect(resolveEventStatus(120, short)).toBe('half_day');
    expect(resolveEventStatus(240, short)).toBe('present');
    // Same input, different verdict under the default thresholds.
    expect(resolveEventStatus(240, STD)).toBe('half_day');
  });

  it('never returns half_day when the two thresholds are equal', () => {
    const eq: ShiftThresholds = { minHalfDayMinutes: 480, minFullDayMinutes: 480 };
    expect(resolveEventStatus(479, eq)).toBe('absent');
    expect(resolveEventStatus(480, eq)).toBe('present');
  });
});

describe('thresholdsFrom — shift → org → constant precedence', () => {
  const shift = { min_half_day_minutes: 120, min_full_day_minutes: 240 };
  const org: ShiftThresholds = { minHalfDayMinutes: 200, minFullDayMinutes: 400 };

  it('prefers the assigned shift over the org rules', () => {
    expect(thresholdsFrom(shift, org)).toEqual({ minHalfDayMinutes: 120, minFullDayMinutes: 240 });
  });

  it('falls back to the org rules when there is no shift assignment', () => {
    expect(thresholdsFrom(null, org)).toEqual(org);
  });

  it('falls back to the constants when neither is configured', () => {
    expect(thresholdsFrom(null, null)).toEqual(DEFAULT_THRESHOLDS);
    expect(thresholdsFrom(undefined, undefined)).toEqual(DEFAULT_THRESHOLDS);
  });

  it('still prefers the shift when the org has no rules row', () => {
    expect(thresholdsFrom(shift, null)).toEqual({ minHalfDayMinutes: 120, minFullDayMinutes: 240 });
  });
});

describe('summarizeSessions — sum of paired sessions', () => {
  it('sums a split shift instead of spanning the gap', () => {
    // THE core assertion of split-shift support: 09:00-13:00 + 17:00-21:00 is
    // 480 minutes worked. The old last_out - first_in span scored 720 and paid
    // the employee for the 4-hour gap between segments.
    const events = [
      at('09:00', 'check_in'), at('13:00', 'check_out'),
      at('17:00', 'check_in'), at('21:00', 'check_out'),
    ];
    expect(summarizeSessions(events)).toEqual({ workedMinutes: 480, hasOpenSession: false });
  });

  it('sums three segments', () => {
    const events = [
      at('06:00', 'check_in'), at('08:00', 'check_out'),
      at('12:00', 'check_in'), at('14:00', 'check_out'),
      at('18:00', 'check_in'), at('20:00', 'check_out'),
    ];
    expect(summarizeSessions(events).workedMinutes).toBe(360);
  });

  it('matches the old span for a single continuous session', () => {
    // Regression guard: nothing changes for a normal one-pair day.
    const events = [at('09:00', 'check_in'), at('17:30', 'check_out')];
    expect(summarizeSessions(events)).toEqual({ workedMinutes: 510, hasOpenSession: false });
  });

  it('scores an abandoned session as zero and flags the day', () => {
    // Forgot to punch out of segment 1, then punched segment 2. The abandoned
    // 09:00 session contributes NO minutes — carrying its cursor to the 21:00
    // check-out would credit 720 and reintroduce the gap-counting bug.
    const events = [
      at('09:00', 'check_in'),                          // never closed
      at('17:00', 'check_in'), at('21:00', 'check_out'),
    ];
    expect(summarizeSessions(events)).toEqual({ workedMinutes: 240, hasOpenSession: true });
  });

  it('flags a trailing check-in with no check-out', () => {
    const events = [
      at('09:00', 'check_in'), at('13:00', 'check_out'),
      at('17:00', 'check_in'),
    ];
    expect(summarizeSessions(events)).toEqual({ workedMinutes: 240, hasOpenSession: true });
  });

  it('reports null (not zero) while the only session is still open', () => {
    // null is what keeps resolveEventStatus returning tentative 'present'
    // mid-shift; a 0 would classify the employee absent while they are at work.
    expect(summarizeSessions([at('09:00', 'check_in')])).toEqual({
      workedMinutes: null,
      hasOpenSession: true,
    });
  });

  it('returns null for a day with no events', () => {
    expect(summarizeSessions([])).toEqual({ workedMinutes: null, hasOpenSession: false });
  });

  it('ignores an orphan check-out with nothing open', () => {
    const events = [at('09:00', 'check_out'), at('10:00', 'check_in'), at('12:00', 'check_out')];
    expect(summarizeSessions(events)).toEqual({ workedMinutes: 120, hasOpenSession: false });
  });

  it('restarts from the later check-in when two arrive before any check-out', () => {
    // The second check-in supersedes the first, so only 09:30-13:00 is credited.
    // Counting from 09:00 would pay for time the employee never punched into.
    const events = [at('09:00', 'check_in'), at('09:30', 'check_in'), at('13:00', 'check_out')];
    expect(summarizeSessions(events)).toEqual({ workedMinutes: 210, hasOpenSession: true });
  });

  it('handles a night session crossing midnight', () => {
    const events: SessionEvent[] = [
      { occurred_at: '2026-07-28T22:00:00.000Z', event_type: 'check_in' },
      { occurred_at: '2026-07-29T02:00:00.000Z', event_type: 'check_out' },
    ];
    expect(summarizeSessions(events).workedMinutes).toBe(240);
  });

  it('never returns a negative total from out-of-order timestamps', () => {
    const events: SessionEvent[] = [
      { occurred_at: '2026-07-28T13:00:00.000Z', event_type: 'check_in' },
      { occurred_at: '2026-07-28T09:00:00.000Z', event_type: 'check_out' },
    ];
    expect(summarizeSessions(events).workedMinutes).toBe(0);
  });
});

describe('resolveEventStatus + summarizeSessions together', () => {
  it('a split shift reaching 480 minutes is Present, though its span is 12 hours', () => {
    const events = [
      at('09:00', 'check_in'), at('13:00', 'check_out'),
      at('17:00', 'check_in'), at('21:00', 'check_out'),
    ];
    const { workedMinutes } = summarizeSessions(events);
    expect(resolveEventStatus(workedMinutes, STD)).toBe('present');
  });

  it('a split-shift day missing its second segment lands on half_day', () => {
    const events = [at('09:00', 'check_in'), at('13:00', 'check_out')];
    const { workedMinutes } = summarizeSessions(events);
    expect(workedMinutes).toBe(240);
    expect(resolveEventStatus(workedMinutes, STD)).toBe('half_day');
  });

  it('reproduces the reported 12:01am–12:04am day end to end', () => {
    const events: SessionEvent[] = [
      { occurred_at: '2026-07-28T00:01:00.000Z', event_type: 'check_in' },
      { occurred_at: '2026-07-28T00:04:00.000Z', event_type: 'check_out' },
    ];
    const { workedMinutes } = summarizeSessions(events);
    expect(workedMinutes).toBe(3);
    expect(resolveEventStatus(workedMinutes, STD)).toBe('absent');
  });
});
