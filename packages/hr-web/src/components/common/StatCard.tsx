import type { ReactNode } from 'react';

type Tone = 'primary' | 'success' | 'due' | 'overdue' | 'info' | 'neutral';

const ACCENT: Record<Tone, string> = {
  primary: 'bg-primary',
  success: 'bg-status-success',
  due: 'bg-status-due',
  overdue: 'bg-status-overdue',
  info: 'bg-status-info',
  neutral: 'bg-outline-variant',
};

/** The KPI card the Stitch screens repeat: a small caption, one big number, a line of context. */
export default function StatCard({ label, value, hint, tone = 'primary', icon, action }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${ACCENT[tone]}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
        {icon}
      </div>
      <p className="mt-1 font-mono text-headline-lg font-bold tabular-nums text-on-surface">{value}</p>
      {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
