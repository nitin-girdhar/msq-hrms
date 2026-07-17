import { describe, it, expect } from 'vitest';
import {
  localDateOf,
  localTimeMinutes,
  weekdayOf,
  parseTimeToMinutes,
  addDays,
  minutesBetween,
  workDateOf,
  isLateArrival,
  isEarlyExit,
} from '../time.js';

const IST = 'Asia/Kolkata'; // UTC+5:30, no DST
const NY = 'America/New_York';

describe('localDateOf (org timezone vs UTC)', () => {
  it('rolls a late-evening UTC punch into the next IST day', () => {
    // 2026-07-14T20:00:00Z = 2026-07-15T01:30 IST → local date is the 15th.
    const instant = new Date('2026-07-14T20:00:00Z');
    expect(localDateOf(instant, IST)).toBe('2026-07-15');
    expect(localDateOf(instant, 'UTC')).toBe('2026-07-14');
  });

  it('keeps a morning UTC punch on the same IST day', () => {
    const instant = new Date('2026-07-15T04:00:00Z'); // 09:30 IST
    expect(localDateOf(instant, IST)).toBe('2026-07-15');
  });
});

describe('localTimeMinutes', () => {
  it('returns IST minutes-since-midnight for a UTC instant', () => {
    // 03:30Z = 09:00 IST → 9*60 = 540.
    expect(localTimeMinutes(new Date('2026-07-15T03:30:00Z'), IST)).toBe(540);
  });
});

describe('weekdayOf', () => {
  it('maps dates to 0=Sunday..6=Saturday', () => {
    expect(weekdayOf('2026-07-12')).toBe(0); // Sunday
    expect(weekdayOf('2026-07-18')).toBe(6); // Saturday
    expect(weekdayOf('2026-07-15')).toBe(3); // Wednesday
  });
});

describe('parseTimeToMinutes / addDays / minutesBetween', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('22:00:00')).toBe(1320);
  });
  it('adds and subtracts days across month boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
  });
  it('computes whole minutes between two instants', () => {
    expect(minutesBetween(new Date('2026-07-15T03:30:00Z'), new Date('2026-07-15T12:00:00Z'))).toBe(510);
  });
});

describe('workDateOf — night shift midnight crossing', () => {
  const shiftStart = parseTimeToMinutes('22:00'); // 10 PM night shift

  it('day shift: work date is simply the local date', () => {
    const instant = new Date('2026-07-15T04:00:00Z'); // 09:30 IST
    expect(workDateOf(instant, IST, false, parseTimeToMinutes('09:00'))).toBe('2026-07-15');
  });

  it('night shift: an evening check-in stays on its own local date', () => {
    // 2026-07-15T17:00Z = 22:30 IST (after shift start) → work date 15th.
    const checkIn = new Date('2026-07-15T17:00:00Z');
    expect(workDateOf(checkIn, IST, true, shiftStart)).toBe('2026-07-15');
  });

  it('night shift: an early-morning check-out belongs to the previous local date', () => {
    // 2026-07-15T20:30Z = 2026-07-16T02:00 IST (before shift start) → work date 15th.
    const checkOut = new Date('2026-07-15T20:30:00Z');
    expect(workDateOf(checkOut, IST, true, shiftStart)).toBe('2026-07-15');
  });

  it('night shift: the pair (evening in + morning out) resolves to the same work date', () => {
    const checkIn = new Date('2026-07-15T17:00:00Z'); // 22:30 IST on 15th
    const checkOut = new Date('2026-07-15T20:30:00Z'); // 02:00 IST on 16th
    expect(workDateOf(checkIn, IST, true, shiftStart)).toBe(workDateOf(checkOut, IST, true, shiftStart));
  });
});

describe('isLateArrival / isEarlyExit', () => {
  it('flags late arrival past shift start + grace', () => {
    // 09:00 start, 10 min grace → late after 09:10 (550 min).
    expect(isLateArrival(551, 540, 10)).toBe(true);
    expect(isLateArrival(550, 540, 10)).toBe(false);
    expect(isLateArrival(545, 540, 10)).toBe(false);
  });
  it('flags early exit before shift end (day shift)', () => {
    // 18:00 end (1080).
    expect(isEarlyExit(1050, 1080, false)).toBe(true);
    expect(isEarlyExit(1080, 1080, false)).toBe(false);
  });
});

describe('timezone with DST (America/New_York)', () => {
  it('handles a summer EDT instant (UTC-4)', () => {
    // 2026-07-15T02:00Z = 2026-07-14T22:00 EDT → local date 14th.
    expect(localDateOf(new Date('2026-07-15T02:00:00Z'), NY)).toBe('2026-07-14');
  });
});
