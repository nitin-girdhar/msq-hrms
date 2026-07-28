import { describe, it, expect } from 'vitest';
import { matchSegment, validateSegments, type ShiftSegment } from '../segments';

// The canonical split shift: 09:00-13:00 and 17:00-21:00 inside a 09:00-21:00 window.
const DAY_SEGMENTS: ShiftSegment[] = [
  { seq: 1, start_time: '09:00:00', end_time: '13:00:00' },
  { seq: 2, start_time: '17:00:00', end_time: '21:00:00' },
];
const DAY_START = 9 * 60;

const hhmm = (h: number, m = 0) => h * 60 + m;

describe('matchSegment — day shift', () => {
  it('matches a punch inside each segment', () => {
    expect(matchSegment(hhmm(9), DAY_SEGMENTS, 0, DAY_START)).toBe(1);
    expect(matchSegment(hhmm(11), DAY_SEGMENTS, 0, DAY_START)).toBe(1);
    expect(matchSegment(hhmm(13), DAY_SEGMENTS, 0, DAY_START)).toBe(1);
    expect(matchSegment(hhmm(17), DAY_SEGMENTS, 0, DAY_START)).toBe(2);
    expect(matchSegment(hhmm(20), DAY_SEGMENTS, 0, DAY_START)).toBe(2);
    expect(matchSegment(hhmm(21), DAY_SEGMENTS, 0, DAY_START)).toBe(2);
  });

  it('returns null in the gap between segments', () => {
    // The 15:00 punch from the plan's verification steps: accepted and counted by
    // the caller, but flagged via is_off_segment.
    expect(matchSegment(hhmm(15), DAY_SEGMENTS, 0, DAY_START)).toBeNull();
    expect(matchSegment(hhmm(14), DAY_SEGMENTS, 0, DAY_START)).toBeNull();
    expect(matchSegment(hhmm(16, 59), DAY_SEGMENTS, 0, DAY_START)).toBeNull();
  });

  it('returns null before the first and after the last segment', () => {
    expect(matchSegment(hhmm(8), DAY_SEGMENTS, 0, DAY_START)).toBeNull();
    expect(matchSegment(hhmm(22), DAY_SEGMENTS, 0, DAY_START)).toBeNull();
  });

  it('widens each segment by the grace minutes on both edges', () => {
    // 08:50 and 13:10 are outside the raw slot but inside a 10-minute grace.
    expect(matchSegment(hhmm(8, 50), DAY_SEGMENTS, 10, DAY_START)).toBe(1);
    expect(matchSegment(hhmm(13, 10), DAY_SEGMENTS, 10, DAY_START)).toBe(1);
    expect(matchSegment(hhmm(16, 50), DAY_SEGMENTS, 10, DAY_START)).toBe(2);
    // Still outside once the grace is exhausted.
    expect(matchSegment(hhmm(8, 45), DAY_SEGMENTS, 10, DAY_START)).toBeNull();
    expect(matchSegment(hhmm(15), DAY_SEGMENTS, 10, DAY_START)).toBeNull();
  });

  it('returns null for an empty segment list so non-split staff are never flagged', () => {
    expect(matchSegment(hhmm(11), [], 10, DAY_START)).toBeNull();
    expect(matchSegment(hhmm(3), [], 0, 0)).toBeNull();
  });
});

describe('matchSegment — night shift wrapping midnight', () => {
  // A 22:00-06:00 night shift split into 22:00-02:00 and 03:00-06:00.
  const NIGHT_SEGMENTS: ShiftSegment[] = [
    { seq: 1, start_time: '22:00:00', end_time: '02:00:00' },
    { seq: 2, start_time: '03:00:00', end_time: '06:00:00' },
  ];
  const NIGHT_START = 22 * 60;

  it('matches punches on both sides of midnight within one segment', () => {
    expect(matchSegment(hhmm(22), NIGHT_SEGMENTS, 0, NIGHT_START)).toBe(1);
    expect(matchSegment(hhmm(23, 30), NIGHT_SEGMENTS, 0, NIGHT_START)).toBe(1);
    // Past midnight — the normalization is what makes this a forward range
    // rather than an inverted one.
    expect(matchSegment(hhmm(0, 30), NIGHT_SEGMENTS, 0, NIGHT_START)).toBe(1);
    expect(matchSegment(hhmm(2), NIGHT_SEGMENTS, 0, NIGHT_START)).toBe(1);
  });

  it('matches the post-midnight second segment', () => {
    expect(matchSegment(hhmm(3), NIGHT_SEGMENTS, 0, NIGHT_START)).toBe(2);
    expect(matchSegment(hhmm(5, 30), NIGHT_SEGMENTS, 0, NIGHT_START)).toBe(2);
  });

  it('returns null in the post-midnight gap and outside the shift', () => {
    expect(matchSegment(hhmm(2, 30), NIGHT_SEGMENTS, 0, NIGHT_START)).toBeNull();
    expect(matchSegment(hhmm(12), NIGHT_SEGMENTS, 0, NIGHT_START)).toBeNull();
    expect(matchSegment(hhmm(20), NIGHT_SEGMENTS, 0, NIGHT_START)).toBeNull();
  });
});

describe('validateSegments', () => {
  it('accepts the canonical split shift', () => {
    expect(validateSegments(DAY_SEGMENTS, '09:00', '21:00')).toBeNull();
  });

  it('accepts segments that exactly fill the window', () => {
    const back2back: ShiftSegment[] = [
      { seq: 1, start_time: '09:00', end_time: '13:00' },
      { seq: 2, start_time: '13:00', end_time: '17:00' },
    ];
    expect(validateSegments(back2back, '09:00', '17:00')).toBeNull();
  });

  it('rejects fewer than two segments', () => {
    expect(validateSegments([], '09:00', '21:00')).toMatch(/at least 2/);
    expect(validateSegments([DAY_SEGMENTS[0]!], '09:00', '21:00')).toMatch(/at least 2/);
  });

  it('rejects overlapping segments', () => {
    const overlapping: ShiftSegment[] = [
      { seq: 1, start_time: '09:00', end_time: '14:00' },
      { seq: 2, start_time: '13:00', end_time: '21:00' },
    ];
    expect(validateSegments(overlapping, '09:00', '21:00')).toMatch(/overlap/);
  });

  it('rejects a segment reaching past the shift window', () => {
    const outside: ShiftSegment[] = [
      { seq: 1, start_time: '09:00', end_time: '13:00' },
      { seq: 2, start_time: '17:00', end_time: '23:00' },
    ];
    expect(validateSegments(outside, '09:00', '21:00')).toMatch(/outside the shift window/);
  });

  it('rejects a duplicate seq', () => {
    const dupes: ShiftSegment[] = [
      { seq: 1, start_time: '09:00', end_time: '13:00' },
      { seq: 1, start_time: '17:00', end_time: '21:00' },
    ];
    expect(validateSegments(dupes, '09:00', '21:00')).toMatch(/Duplicate segment order/);
  });

  it('rejects a non-contiguous seq run', () => {
    const gapped: ShiftSegment[] = [
      { seq: 1, start_time: '09:00', end_time: '13:00' },
      { seq: 3, start_time: '17:00', end_time: '21:00' },
    ];
    expect(validateSegments(gapped, '09:00', '21:00')).toMatch(/without gaps/);
  });

  it('accepts a night shift whose segments wrap midnight', () => {
    const night: ShiftSegment[] = [
      { seq: 1, start_time: '22:00', end_time: '02:00' },
      { seq: 2, start_time: '03:00', end_time: '06:00' },
    ];
    expect(validateSegments(night, '22:00', '06:00')).toBeNull();
  });

  it('rejects a night segment that runs past the shift end', () => {
    const night: ShiftSegment[] = [
      { seq: 1, start_time: '22:00', end_time: '02:00' },
      { seq: 2, start_time: '03:00', end_time: '08:00' },
    ];
    expect(validateSegments(night, '22:00', '06:00')).toMatch(/outside the shift window/);
  });
});
