import { describe, it, expect } from 'vitest';
import { punchEligibility } from '../punch-eligibility.js';

const REGULAR = { hasShift: true, isSplit: false, segmentCount: 0 };
const SPLIT_2 = { hasShift: true, isSplit: true, segmentCount: 2 };
const NO_SHIFT = { hasShift: false, isSplit: false, segmentCount: 0 };

describe('punchEligibility — regular shift', () => {
  it('allows the first check-in of the day', () => {
    const e = punchEligibility({ checkIns: 0, checkOuts: 0 }, REGULAR);
    expect(e.canCheckIn).toBe(true);
    expect(e.canCheckOut).toBe(false);
  });

  it('offers check-out while a session is open, and refuses a second check-in', () => {
    const e = punchEligibility({ checkIns: 1, checkOuts: 0 }, REGULAR);
    expect(e.canCheckOut).toBe(true);
    expect(e.canCheckIn).toBe(false);
    expect(e.checkInBlockedBy).toBe('ALREADY_CHECKED_IN');
    expect(e.hasOpenSession).toBe(true);
  });

  it('is done for the day once the pair is complete', () => {
    const e = punchEligibility({ checkIns: 1, checkOuts: 1 }, REGULAR);
    expect(e.canCheckIn).toBe(false);
    expect(e.canCheckOut).toBe(false);
    expect(e.checkInBlockedBy).toBe('ALREADY_COMPLETED_TODAY');
  });
});

describe('punchEligibility — split shift', () => {
  // The regression this module exists for: the dashboard used to read
  // first_in/last_out and disable the button here, stranding the employee
  // mid-shift even though the server would have accepted segment 2.
  it('allows the next slot after the first in/out pair is closed', () => {
    const e = punchEligibility({ checkIns: 1, checkOuts: 1 }, SPLIT_2);
    expect(e.canCheckIn).toBe(true);
    expect(e.checkInBlockedBy).toBeNull();
    expect(e.segmentsPunched).toBe(1);
    expect(e.segmentsTotal).toBe(2);
  });

  it('stops once every declared segment has been punched', () => {
    const e = punchEligibility({ checkIns: 2, checkOuts: 2 }, SPLIT_2);
    expect(e.canCheckIn).toBe(false);
    expect(e.checkInBlockedBy).toBe('SEGMENT_LIMIT_REACHED');
  });

  it('still allows the next slot when the previous one was left open', () => {
    // Forgetting to punch out of segment 1 must not lock the rest of the day.
    const e = punchEligibility({ checkIns: 1, checkOuts: 0 }, SPLIT_2);
    expect(e.canCheckIn).toBe(true);
    expect(e.canCheckOut).toBe(true);
    expect(e.hasOpenSession).toBe(true);
  });

  it('applies no segment cap when the shift declares none', () => {
    const e = punchEligibility({ checkIns: 5, checkOuts: 5 }, { hasShift: true, isSplit: true, segmentCount: 0 });
    expect(e.canCheckIn).toBe(true);
  });
});

describe('punchEligibility — no assigned shift', () => {
  it('blocks a second concurrent check-in', () => {
    const e = punchEligibility({ checkIns: 1, checkOuts: 0 }, NO_SHIFT);
    expect(e.checkInBlockedBy).toBe('ALREADY_CHECKED_IN');
  });

  it('does not cap completed pairs — there is no shift to judge against', () => {
    const e = punchEligibility({ checkIns: 1, checkOuts: 1 }, NO_SHIFT);
    expect(e.canCheckIn).toBe(true);
  });
});
