'use client';

export const PAGE_SIZES = [10, 25, 50] as const;

/** "Showing 1 - 12 of 128" with rows-per-page and page buttons, the footer every Stitch list carries. */
export default function Pagination({ page, pageSize, total, onPage, onPageSize, noun = 'records' }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  // A short window of page numbers around the current one, with the first and last always reachable.
  const nums = Array.from(new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))).sort((a, b) => a - b);
  const btn = 'min-w-8 rounded-lg border px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant px-4 py-3 text-xs text-on-surface-variant">
      <span>Showing <strong className="text-on-surface">{from} - {to}</strong> of {total} {noun}</span>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            Rows per page
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs text-on-surface">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <nav aria-label="Pages" className="flex items-center gap-1">
          <button type="button" className={`${btn} border-outline-variant bg-surface-container-lowest`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && n - nums[i - 1]! > 1 && <span aria-hidden="true">…</span>}
              <button type="button" onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}
                className={`${btn} ${n === page ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-lowest text-on-surface'}`}>{n}</button>
            </span>
          ))}
          <button type="button" className={`${btn} border-outline-variant bg-surface-container-lowest`} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
        </nav>
      </div>
    </div>
  );
}
