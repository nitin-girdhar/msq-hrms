import { describe, it, expect } from 'vitest';
import { planRange, shiftOnAfter, restProblems, eachDate, mondayOf, rangeFor, overlapsOnShift, type Window } from '../planner.js';
import type { ShiftTimes } from '../swap.js';

const day: ShiftTimes = { id: 'day', start: '09:00', end: '17:00', isNight: false };
const night: ShiftTimes = { id: 'night', start: '23:00', end: '07:00', isNight: true };

const w = (id: string, shiftId: string, from: string, to: string | null): Window => ({ id, shiftId, from, to });

describe('planRange', () => {
  it('splits one assignment around a middle range and keeps both sides', () => {
    const ops = planRange([w('a', 'S1', '2026-10-01', '2026-10-31')], '2026-10-10', '2026-10-12', 'S2');
    expect(ops).toEqual([
      { kind: 'shrink', id: 'a', newTo: '2026-10-09' },
      { kind: 'insert', shiftId: 'S1', from: '2026-10-13', to: '2026-10-31' },
      { kind: 'insert', shiftId: 'S2', from: '2026-10-10', to: '2026-10-12' },
    ]);
  });

  it('keeps an open-ended assignment open on the right', () => {
    const ops = planRange([w('a', 'S1', '2026-10-01', null)], '2026-10-10', '2026-10-10', 'S2');
    expect(ops).toContainEqual({ kind: 'insert', shiftId: 'S1', from: '2026-10-11', to: null });
  });

  it('deletes an assignment fully inside the range', () => {
    const ops = planRange([w('a', 'S1', '2026-10-10', '2026-10-11')], '2026-10-09', '2026-10-12', 'S2');
    expect(ops).toEqual([{ kind: 'delete', id: 'a' }, { kind: 'insert', shiftId: 'S2', from: '2026-10-09', to: '2026-10-12' }]);
  });

  it('shrinks the left row when the range starts mid-assignment and runs past its end', () => {
    const ops = planRange([w('a', 'S1', '2026-10-01', '2026-10-10')], '2026-10-08', '2026-10-15', 'S2');
    expect(ops).toEqual([{ kind: 'shrink', id: 'a', newTo: '2026-10-07' }, { kind: 'insert', shiftId: 'S2', from: '2026-10-08', to: '2026-10-15' }]);
  });

  it('clears a range when no shift is given: nothing is inserted for the range', () => {
    const ops = planRange([w('a', 'S1', '2026-10-01', '2026-10-31')], '2026-10-10', '2026-10-10', null);
    expect(ops.filter((o) => o.kind === 'insert')).toEqual([{ kind: 'insert', shiftId: 'S1', from: '2026-10-11', to: '2026-10-31' }]);
    expect(shiftOnAfter([w('a', 'S1', '2026-10-01', '2026-10-31')], ops, '2026-10-10')).toBeNull();
    expect(shiftOnAfter([w('a', 'S1', '2026-10-01', '2026-10-31')], ops, '2026-10-09')).toBe('S1');
    expect(shiftOnAfter([w('a', 'S1', '2026-10-01', '2026-10-31')], ops, '2026-10-11')).toBe('S1');
  });

  it('leaves rows that do not touch the range alone', () => {
    const ops = planRange([w('a', 'S1', '2026-09-01', '2026-09-30'), w('b', 'S1', '2026-11-01', null)], '2026-10-10', '2026-10-12', 'S2');
    expect(ops).toEqual([{ kind: 'insert', shiftId: 'S2', from: '2026-10-10', to: '2026-10-12' }]);
  });

  it('puts every shrink and delete before any insert', () => {
    const ops = planRange([w('a', 'S1', '2026-10-01', '2026-10-31')], '2026-10-10', '2026-10-12', 'S2');
    const firstInsert = ops.findIndex((o) => o.kind === 'insert');
    expect(ops.slice(firstInsert).every((o) => o.kind === 'insert')).toBe(true);
  });

  it('rejects an inverted range', () => {
    expect(() => planRange([], '2026-10-12', '2026-10-10', 'S1')).toThrow();
  });

  it('leaves a person with exactly one shift per day after a range edit (no overlap, no gap outside it)', () => {
    const before = [w('a', 'S1', '2026-10-01', '2026-10-31')];
    const ops = planRange(before, '2026-10-10', '2026-10-12', 'S2');
    for (const d of eachDate('2026-10-01', '2026-10-31')) {
      const expected = d >= '2026-10-10' && d <= '2026-10-12' ? 'S2' : 'S1';
      expect(shiftOnAfter(before, ops, d)).toBe(expected);
    }
  });
});

describe('restProblems', () => {
  const lookup = (map: Record<string, ShiftTimes | null>) => (d: string) => map[d] ?? null;

  it('is quiet when day shifts follow each other', () => {
    const f = lookup({ '2026-10-10': day, '2026-10-11': day, '2026-10-12': day });
    expect(restProblems(f, '2026-10-11', '2026-10-11')).toEqual([]);
  });

  it('flags a day shift straight after a night shift', () => {
    const f = lookup({ '2026-10-10': night, '2026-10-11': day });
    const p = restProblems(f, '2026-10-11', '2026-10-11');
    expect(p.length).toBeGreaterThan(0);
    expect(p[0]!.reason).toMatch(/rest/);
  });

  it('reports each date once even though both neighbours see the gap', () => {
    const f = lookup({ '2026-10-10': night, '2026-10-11': day });
    const dates = restProblems(f, '2026-10-10', '2026-10-11').map((x) => x.date);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe('restProblems policy', () => {
  const lookup = (map: Record<string, ShiftTimes | null>) => (d: string) => map[d] ?? null;

  it('is quiet for every gap when the policy is 0', () => {
    const f = lookup({ '2026-10-10': night, '2026-10-11': day });
    expect(restProblems(f, '2026-10-10', '2026-10-11', 0)).toEqual([]);
  });

  it('follows a longer policy', () => {
    const f = lookup({ '2026-10-10': day, '2026-10-11': day });
    expect(restProblems(f, '2026-10-11', '2026-10-11', 11)).toEqual([]);
    expect(restProblems(f, '2026-10-11', '2026-10-11', 24).length).toBeGreaterThan(0);
  });

  it("lets a shift's own value win over the policy", () => {
    const relaxed: ShiftTimes = { ...day, minRestHours: 0 };
    const f = lookup({ '2026-10-10': night, '2026-10-11': relaxed });
    expect(restProblems(f, '2026-10-11', '2026-10-11', 11)).toEqual([]);
  });
});

describe('dates', () => {
  it('lists a range inclusively', () => expect(eachDate('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']));
  it('finds the Monday of a week, including from a Sunday', () => {
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(mondayOf('2026-10-08')).toBe('2026-10-05');
  });
});

describe('rangeFor', () => {
  it('a day is itself', () => expect(rangeFor('day', '2026-10-07')).toEqual({ start: '2026-10-07', end: '2026-10-07' }));
  it('a week runs Monday to Sunday', () => expect(rangeFor('week', '2026-10-07')).toEqual({ start: '2026-10-05', end: '2026-10-11' }));
  it('a month runs from the 1st to its last day, including February in a leap year and December', () => {
    expect(rangeFor('month', '2026-10-15')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(rangeFor('month', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(rangeFor('month', '2026-12-31')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
});

describe('overlapsOnShift', () => {
  const rows: Window[] = [w('a', 'S1', '2026-10-01', '2026-10-10'), w('b', 'S2', '2026-10-11', '2026-10-20'), w('c', 'S1', '2026-10-21', null)];
  it('clips each matching row to the range and ignores other shifts', () => {
    expect(overlapsOnShift(rows, 'S1', '2026-10-08', '2026-10-25')).toEqual([{ from: '2026-10-08', to: '2026-10-10' }, { from: '2026-10-21', to: '2026-10-25' }]);
  });
  it('returns nothing when the person was never on that shift in the range', () => {
    expect(overlapsOnShift(rows, 'S2', '2026-10-01', '2026-10-05')).toEqual([]);
  });
});
