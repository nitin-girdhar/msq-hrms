import type { LeaveBalance } from '../../lib/leave/types';
import { emptyBlockCls } from '../../lib/ui';

interface Props {
  balances: LeaveBalance[];
}

// Segment colours, in order. The first follows the tenant brand; the rest are the
// fixed categorical hues, so "Sick" is the same colour for every tenant. CSS
// variables, not hex, so a brand or dark-mode change reaches the chart.
const SEGMENT_COLORS = [
  'var(--color-primary)',
  'var(--color-cat-cyan)',
  'var(--color-cat-orange)',
  'var(--color-cat-purple)',
  'var(--color-cat-pink)',
  'var(--color-status-success)',
];

const R = 42;
const CIRC = 2 * Math.PI * R;

/**
 * Leave balances as a ring (Stitch "Leave Balance" donut) plus a legend row per
 * leave type. The centre is the sum of positive balances; a type at or below zero
 * keeps its legend row but takes no arc, so the ring never goes negative.
 */
export default function BalanceCards({ balances }: Props) {
  if (balances.length === 0) {
    return <p className={emptyBlockCls}>No leave balances yet. Balances appear once a leave policy is configured for your org.</p>;
  }

  const total = balances.reduce((sum, b) => sum + Math.max(0, Number(b.balance) || 0), 0);
  let offset = 0;
  const arcs = balances.map((b, i) => {
    const value = Math.max(0, Number(b.balance) || 0);
    const len = total > 0 ? (value / total) * CIRC : 0;
    const arc = { key: b.leave_type_id, len, offset, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] };
    offset += len;
    return arc;
  });

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:flex-row sm:items-center sm:gap-8 sm:p-5">
      <div className="relative mx-auto h-32 w-32 shrink-0 sm:mx-0 sm:h-36 sm:w-36" role="img" aria-label={`${total} leave days available in total`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" stroke="var(--color-surface-container)" />
          {arcs.map((a) =>
            a.len > 0 ? (
              <circle
                key={a.key}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                strokeWidth="10"
                stroke={a.color}
                strokeDasharray={`${a.len} ${CIRC - a.len}`}
                strokeDashoffset={-a.offset}
              />
            ) : null,
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-headline-lg font-bold tabular-nums text-on-surface">{total}</span>
          <span className="text-label-sm text-on-surface-variant">days available</span>
        </div>
      </div>

      <ul className="grid flex-1 grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {balances.map((b, i) => (
          <li key={b.leave_type_id} className="flex items-center justify-between gap-3 border-b border-outline-variant/50 pb-2 last:border-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }} aria-hidden="true" />
              <span className="truncate text-sm text-on-surface">{b.leave_type_label}</span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-label-sm font-semibold ${
                  b.is_paid ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                {b.is_paid ? 'Paid' : 'Unpaid'}
              </span>
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-on-surface">{b.balance}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
