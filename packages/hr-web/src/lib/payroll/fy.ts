// Indian financial year (1 April to 31 March) helpers for the payslip archive.

/** '2026-04-01' -> 'FY 2026-27'; '2026-03-01' -> 'FY 2025-26'. */
export function financialYear(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Group items by the financial year of `period`, newest year first (items keep their order within a year). */
export function groupByFinancialYear<T extends { period: string }>(items: T[]): Array<{ fy: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const fy = financialYear(it.period);
    const list = map.get(fy);
    if (list) list.push(it); else map.set(fy, [it]);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([fy, list]) => ({ fy, items: list }));
}
