import type { RegularizationView } from '../../lib/attendance/types';

interface Props {
  items: RegularizationView[];
  /** Today in the org timezone (YYYY-MM-DD) — the quarter is measured against it. */
  today: string;
}

// First day of the calendar quarter containing `isoDate`, as YYYY-MM-DD.
function quarterStart(isoDate: string): string {
  const year = isoDate.slice(0, 4);
  const month = Number(isoDate.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(first).padStart(2, '0')}-01`;
}

/**
 * Two figures above the regularization list: requests still awaiting a decision
 * and requests approved this quarter. Both come from the employee's OWN list, so
 * they stay correct without a new endpoint.
 *
 * The Stitch design also shows a "compliance %" against a benchmark. It has no
 * defined meaning in this product (no policy target exists), so it is
 * intentionally not built until one is agreed.
 */
export default function RegularizationStats({ items, today }: Props) {
  const since = quarterStart(today);
  const pending = items.filter((r) => r.status === 'pending').length;
  const approvedThisQuarter = items.filter((r) => r.status === 'approved' && r.work_date >= since).length;

  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat label="Pending approvals" value={pending} tone={pending > 0 ? 'due' : 'neutral'} hint="awaiting a decision" />
      <Stat label="Approved this quarter" value={approvedThisQuarter} tone="success" hint="regularized days" />
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: 'due' | 'success' | 'neutral' }) {
  const badge =
    tone === 'due'
      ? 'bg-status-due-container text-on-status-due-container'
      : tone === 'success'
        ? 'bg-status-success-container text-on-status-success-container'
        : 'bg-surface-container text-on-surface-variant';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm sm:p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-headline-sm font-bold tabular-nums ${badge}`}>
        {value}
      </span>
      <div className="min-w-0">
        <p className="truncate text-label-md font-semibold text-on-surface">{label}</p>
        <p className="truncate text-label-sm text-on-surface-variant">{hint}</p>
      </div>
    </div>
  );
}
