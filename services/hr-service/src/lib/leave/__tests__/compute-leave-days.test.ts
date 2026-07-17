import { describe, it, expect } from 'vitest';
import { computeLeaveDays } from '../compute-leave-days';

// Weekly off pattern: Sun (0) + Sat (6) unless a test overrides it.
const SAT_SUN = [0, 6];

describe('computeLeaveDays', () => {
  it('counts plain working days with no holidays or offs', () => {
    // Mon 2026-07-13 .. Wed 2026-07-15 = 3 working days
    expect(computeLeaveDays('2026-07-13', '2026-07-15', 'full', 'full', [], SAT_SUN)).toBe(3);
  });

  it('excludes a weekend inside the span', () => {
    // Fri 2026-07-17 .. Mon 2026-07-20 spans Sat+Sun → only Fri + Mon = 2
    expect(computeLeaveDays('2026-07-17', '2026-07-20', 'full', 'full', [], SAT_SUN)).toBe(2);
  });

  it('excludes an org holiday inside the span', () => {
    // Mon..Wed with Tue as a holiday → 2 days
    expect(
      computeLeaveDays('2026-07-13', '2026-07-15', 'full', 'full', ['2026-07-14'], SAT_SUN),
    ).toBe(2);
  });

  it('treats a half-day request on a single day as 0.5', () => {
    expect(computeLeaveDays('2026-07-13', '2026-07-13', 'first_half', 'full', [], SAT_SUN)).toBe(0.5);
    expect(computeLeaveDays('2026-07-13', '2026-07-13', 'full', 'second_half', [], SAT_SUN)).toBe(0.5);
  });

  it('applies half-days at both ends of a multi-day span', () => {
    // Mon..Wed, first_half start + second_half end → 3 - 0.5 - 0.5 = 2
    expect(
      computeLeaveDays('2026-07-13', '2026-07-15', 'first_half', 'second_half', [], SAT_SUN),
    ).toBe(2);
  });

  it('honours a custom weekly_off_pattern (Fri+Sat week)', () => {
    // Off = Fri(5) + Sat(6). Wed 2026-07-15 .. Sun 2026-07-19:
    // Wed, Thu, (Fri off), (Sat off), Sun → 3 working days
    expect(computeLeaveDays('2026-07-15', '2026-07-19', 'full', 'full', [], [5, 6])).toBe(3);
  });

  it('does not reduce for a half marker landing on a non-working endpoint', () => {
    // Sat 2026-07-18 (off) .. Mon 2026-07-20: start is a weekend, so its
    // half marker reduces nothing → just Monday = 1
    expect(
      computeLeaveDays('2026-07-18', '2026-07-20', 'first_half', 'full', [], SAT_SUN),
    ).toBe(1);
  });

  it('returns 0 when the whole span is non-working', () => {
    // Sat + Sun
    expect(computeLeaveDays('2026-07-18', '2026-07-19', 'full', 'full', [], SAT_SUN)).toBe(0);
  });

  it('returns 0 for an inverted range', () => {
    expect(computeLeaveDays('2026-07-15', '2026-07-13', 'full', 'full', [], SAT_SUN)).toBe(0);
  });
});
