import { describe, expect, it } from 'vitest';
import {
  checkSwap,
  planSplit,
  restGapProblem,
  shiftSpan,
  type DayContext,
  type ShiftTimes,
} from '../swap.js';

const MORNING: ShiftTimes = { id: 'm', start: '08:00', end: '16:00', isNight: false };
const EVENING: ShiftTimes = { id: 'e', start: '14:00', end: '22:00', isNight: false };
const NIGHT: ShiftTimes = { id: 'n', start: '22:00', end: '06:00', isNight: true };

const day = (over: Partial<DayContext> = {}): DayContext => ({
  shift: MORNING, isWeeklyOff: false, isHoliday: false, onLeave: false, prev: null, next: null, ...over,
});

const TODAY = '2026-10-07';
const SWAP = '2026-10-12';

describe('shiftSpan', () => {
  it('runs a night shift past midnight', () => {
    const s = shiftSpan(SWAP, NIGHT);
    expect(s.end - s.start).toBe(8 * 3_600_000);
  });
  it('treats an end equal to the start as a 24h shift, not zero', () => {
    const s = shiftSpan(SWAP, { id: 'x', start: '09:00', end: '09:00', isNight: false });
    expect(s.end - s.start).toBe(24 * 3_600_000);
  });
});

describe('restGapProblem', () => {
  it('allows a long enough rest on both sides', () => {
    // Previous day ended 16:00, new shift starts 08:00 next day = 16h rest. Next day starts 08:00 after a 22:00 end = 10h.
    expect(restGapProblem(SWAP, MORNING, { prev: MORNING, next: null })).toBeNull();
  });
  it('flags a short rest after the previous day', () => {
    // Previous day NIGHT ends 06:00 on SWAP; an EVENING shift starts 14:00 = 8h.
    expect(restGapProblem(SWAP, EVENING, { prev: NIGHT, next: null })).toMatch(/after the previous/);
  });
  it('flags a short rest before the next day', () => {
    // EVENING ends 22:00; a MORNING next day starts 08:00 = 10h < 11h.
    expect(restGapProblem(SWAP, EVENING, { prev: null, next: MORNING })).toMatch(/before the next/);
  });
  it('accepts exactly the minimum', () => {
    // EVENING ends 22:00, next day starts 09:00 = 11h.
    const next: ShiftTimes = { id: 'x', start: '09:00', end: '17:00', isNight: false };
    expect(restGapProblem(SWAP, EVENING, { prev: null, next })).toBeNull();
  });
  it('uses the policy hours passed in, and names them in the reason', () => {
    // EVENING ends 22:00, MORNING next day starts 08:00 = 10h: fine under 8h, short under 12h.
    expect(restGapProblem(SWAP, EVENING, { prev: null, next: MORNING }, 8)).toBeNull();
    expect(restGapProblem(SWAP, EVENING, { prev: null, next: MORNING }, 12)).toMatch(/fewer than 12 hours/);
  });
  it('turns the rule off at 0', () => {
    expect(restGapProblem(SWAP, EVENING, { prev: NIGHT, next: MORNING }, 0)).toBeNull();
  });
  it('lets the shift that starts after the gap override the policy', () => {
    // Next-day MORNING starts 08:00, only 10h after EVENING: its own 0 waives the gap, its own 14 tightens it.
    expect(restGapProblem(SWAP, EVENING, { prev: null, next: { ...MORNING, minRestHours: 0 } })).toBeNull();
    expect(restGapProblem(SWAP, EVENING, { prev: null, next: { ...MORNING, minRestHours: 14 } }, 0)).toMatch(/fewer than 14 hours/);
    // And the incoming shift owns the gap after the previous day.
    expect(restGapProblem(SWAP, { ...EVENING, minRestHours: 0 }, { prev: NIGHT, next: null })).toBeNull();
  });
});

describe('checkSwap', () => {
  const requester = day({ shift: MORNING });
  const peer = day({ shift: EVENING });

  it('accepts a clean swap for a future day', () => {
    expect(checkSwap({ today: TODAY, swapDate: SWAP, requester, peer })).toEqual({ ok: true });
  });
  it('refuses today and past days', () => {
    expect(checkSwap({ today: TODAY, swapDate: TODAY, requester, peer }).ok).toBe(false);
    expect(checkSwap({ today: TODAY, swapDate: '2026-10-01', requester, peer }).ok).toBe(false);
  });
  it('refuses when either person is off, on holiday, on leave, or has no shift', () => {
    for (const bad of [{ isWeeklyOff: true }, { isHoliday: true }, { onLeave: true }, { shift: null }] as const) {
      expect(checkSwap({ today: TODAY, swapDate: SWAP, requester: day(bad), peer }).ok).toBe(false);
      expect(checkSwap({ today: TODAY, swapDate: SWAP, requester, peer: day(bad) }).ok).toBe(false);
    }
  });
  it('refuses two people on the same shift', () => {
    expect(checkSwap({ today: TODAY, swapDate: SWAP, requester, peer: day({ shift: MORNING }) }).ok).toBe(false);
  });
  it('names who would lose the rest gap', () => {
    // The requester worked NIGHT the day before; taking the peer's EVENING leaves 8h.
    const tired = day({ shift: MORNING, prev: NIGHT });
    const v = checkSwap({ today: TODAY, swapDate: SWAP, requester: tired, peer });
    expect(v).toMatchObject({ ok: false });
    expect((v as { reason: string }).reason).toMatch(/^You would have/);
  });
  it('checks the peer too', () => {
    // The peer works MORNING next day; taking the requester's EVENING-ending shift is not tested here —
    // swap the roles so the peer receives EVENING (ends 22:00) and has MORNING (08:00) the next day = 10h.
    const peerTired = day({ shift: MORNING, next: MORNING });
    const v = checkSwap({ today: TODAY, swapDate: SWAP, requester: day({ shift: EVENING }), peer: peerTired });
    expect(v).toMatchObject({ ok: false });
    expect((v as { reason: string }).reason).toMatch(/^They would have/);
  });
});

describe('planSplit', () => {
  it('shrinks an assignment that started earlier and resumes it the day after', () => {
    const plan = planSplit({ id: 'a', shiftId: 'm', from: '2026-10-01', to: null }, SWAP, 'e');
    expect(plan.existing).toEqual({ action: 'shrink', newTo: '2026-10-11' });
    expect(plan.swapDay).toEqual({ shiftId: 'e', from: SWAP, to: SWAP });
    expect(plan.continuation).toEqual({ shiftId: 'm', from: '2026-10-13', to: null });
  });
  it('deletes an assignment that starts on the swap day', () => {
    const plan = planSplit({ id: 'a', shiftId: 'm', from: SWAP, to: '2026-10-20' }, SWAP, 'e');
    expect(plan.existing).toEqual({ action: 'delete' });
    expect(plan.continuation).toEqual({ shiftId: 'm', from: '2026-10-13', to: '2026-10-20' });
  });
  it('adds no continuation when the assignment ends on the swap day', () => {
    const plan = planSplit({ id: 'a', shiftId: 'm', from: '2026-10-01', to: SWAP }, SWAP, 'e');
    expect(plan.continuation).toBeNull();
  });
  it('handles a month boundary', () => {
    const plan = planSplit({ id: 'a', shiftId: 'm', from: '2026-09-01', to: null }, '2026-10-01', 'e');
    expect(plan.existing).toEqual({ action: 'shrink', newTo: '2026-09-30' });
    expect(plan.continuation?.from).toBe('2026-10-02');
  });
  it('refuses a date the assignment does not cover', () => {
    expect(() => planSplit({ id: 'a', shiftId: 'm', from: '2026-10-01', to: '2026-10-05' }, SWAP, 'e')).toThrow();
  });
});
