'use client';

import type { ReactNode } from 'react';
import PersonAvatar from '../common/PersonAvatar';
import type { Completeness } from '../../lib/profile/completeness';
import type { ChainLink } from '../../lib/profile/types';

/** A titled white card, the unit the Stitch profile screens are built from. */
export function Card({ title, subtitle, action, children }: { title: string; subtitle?: string | undefined; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-on-surface">{title}</h3>
          {subtitle && <p className="text-xs text-on-surface-variant">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** One labelled fact on a tinted tile (department, notice period ...). */
export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string | null }) {
  return (
    <div className="rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2.5">
      <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-on-surface">{value || '—'}</p>
      {hint && <p className="text-label-sm text-outline">{hint}</p>}
    </div>
  );
}

export function Avatar({ name, userId, size = 'lg' }: { name: string; userId?: string | null | undefined; size?: 'sm' | 'lg' }) {
  return <PersonAvatar name={name} userId={userId} size={size === 'lg' ? 'lg' : 'sm'} />;
}

/** Completeness as a ring plus what is missing. */
export function CompletenessRing({ value }: { value: Completeness }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Profile ${value.percent}% complete`}>
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-surface-container-high" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-status-success"
          strokeDasharray={`${(value.percent / 100) * c} ${c}`} transform="rotate(-90 32 32)" />
        <text x="32" y="36" textAnchor="middle" className="fill-on-surface text-[0.8125rem] font-bold">{value.percent}%</text>
      </svg>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-on-surface">Profile complete</p>
        <p className="text-xs text-on-surface-variant">
          {value.missing.length === 0 ? 'Everything is filled in.' : `Still missing: ${value.missing.slice(0, 3).join(', ')}${value.missing.length > 3 ? ` and ${value.missing.length - 3} more` : ''}.`}
        </p>
      </div>
    </div>
  );
}

/** Manager chain, nearest first, ending in the person. */
export function ReportingChain({ self, chain }: { self: string; chain: ChainLink[] }) {
  if (chain.length === 0) return <p className="text-sm text-on-surface-variant">No reporting manager on record.</p>;
  // Top of the chain first, the person last, like the Stitch strip.
  const links = [...chain].reverse();
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Reporting chain">
      {links.map((l) => (
        <li key={l.user_id} className="flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-2.5 py-1.5">
            <Avatar name={l.full_name} userId={l.user_id} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-on-surface">{l.full_name}</span>
              {l.designation_name && <span className="block truncate text-label-sm text-on-surface-variant">{l.designation_name}</span>}
            </span>
          </span>
          <span aria-hidden="true" className="text-outline">→</span>
        </li>
      ))}
      <li>
        <span className="flex items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-on-primary">
          <span className="text-sm font-semibold">{self}</span>
        </span>
      </li>
    </ol>
  );
}

const RING_COLOURS = ['stroke-primary', 'stroke-status-success', 'stroke-status-due', 'stroke-cat-indigo', 'stroke-cat-blue', 'stroke-status-info'];
const DOT_COLOURS = ['bg-primary', 'bg-status-success', 'bg-status-due', 'bg-cat-indigo', 'bg-cat-blue', 'bg-status-info'];

/** Leave balances: a donut of what is left per type, with the list beside it. */
export function LeaveBalanceCard({ balances }: { balances: Array<{ leave_type_label: string; balance: number }> }) {
  const positive = balances.filter((b) => b.balance > 0);
  const total = positive.reduce((n, b) => n + b.balance, 0);
  const r = 36;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Card title="Leave balances" subtitle="Days available now" action={<span className="font-mono text-sm font-bold text-on-surface">{Math.round(total * 10) / 10} days</span>}>
      {balances.length === 0 ? (
        <p className="text-sm text-on-surface-variant">No leave balances yet.</p>
      ) : (
        <div className="flex items-center gap-4">
          <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${total} leave days available`} className="shrink-0">
            <circle cx="48" cy="48" r={r} fill="none" strokeWidth="12" className="stroke-surface-container-high" />
            {total > 0 && positive.map((b, i) => {
              const len = (b.balance / total) * c;
              const el = (
                <circle key={b.leave_type_label} cx="48" cy="48" r={r} fill="none" strokeWidth="12" className={RING_COLOURS[i % RING_COLOURS.length]}
                  strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 48 48)" />
              );
              offset += len;
              return el;
            })}
          </svg>
          <ul className="min-w-0 flex-1 space-y-1">
            {balances.map((b, i) => (
              <li key={b.leave_type_label} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-on-surface-variant">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT_COLOURS[i % DOT_COLOURS.length]}`} aria-hidden="true" />
                  <span className="truncate">{b.leave_type_label}</span>
                </span>
                <span className="font-mono font-semibold tabular-nums text-on-surface">{b.balance}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
