import type { ReactNode } from 'react';

type Tone = 'success' | 'due' | 'overdue' | 'info' | 'neutral' | 'primary';

// Status colours are fixed across tenants (skills/react-typescript section 6); only the neutral and
// primary pills follow the tenant theme.
const TONE: Record<Tone, string> = {
  success: 'bg-status-success-container text-on-status-success-container',
  due: 'bg-status-due-container text-on-status-due-container',
  overdue: 'bg-status-overdue-container text-on-status-overdue-container',
  info: 'bg-status-info-container text-on-status-info-container',
  neutral: 'bg-surface-container text-on-surface-variant',
  primary: 'bg-primary-fixed text-on-primary-fixed',
};

export default function StatusPill({ tone = 'neutral', children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-label-sm font-semibold ${TONE[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
