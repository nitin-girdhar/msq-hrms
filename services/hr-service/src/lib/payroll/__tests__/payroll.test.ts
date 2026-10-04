import { describe, expect, it } from 'vitest';
import { computeTotals, monthLabel, monthStart } from '../payroll.js';

describe('computeTotals', () => {
  it('sums earnings and deductions into net', () => {
    expect(
      computeTotals([
        { kind: 'earning', label: 'Basic', amount: 50000 },
        { kind: 'earning', label: 'HRA', amount: 20000.5 },
        { kind: 'deduction', label: 'PF', amount: 6000 },
      ]),
    ).toEqual({ gross: 70000.5, deductions: 6000, net: 64000.5 });
  });
  it('does not drift on binary-float amounts', () => {
    expect(computeTotals([{ kind: 'earning', label: 'a', amount: 0.1 }, { kind: 'earning', label: 'b', amount: 0.2 }]).gross).toBe(0.3);
  });
  it('is zero for no lines', () => {
    expect(computeTotals([])).toEqual({ gross: 0, deductions: 0, net: 0 });
  });
  it('allows a negative net (deductions exceed earnings) rather than hiding it', () => {
    expect(computeTotals([{ kind: 'earning', label: 'a', amount: 100 }, { kind: 'deduction', label: 'b', amount: 150 }]).net).toBe(-50);
  });
});

describe('month helpers', () => {
  it('turns YYYY-MM into the first of the month', () => {
    expect(monthStart('2026-10')).toBe('2026-10-01');
  });
  it('rejects a malformed month', () => {
    expect(() => monthStart('2026-13')).toThrow();
    expect(() => monthStart('2026-1')).toThrow();
  });
  it('labels a month', () => {
    expect(monthLabel('2026-04-01')).toBe('Apr 2026');
  });
});
