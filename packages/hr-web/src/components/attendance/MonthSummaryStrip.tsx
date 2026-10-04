import type { AttendanceDayRow } from '../../lib/attendance/types';
import { formatWorkedMinutes } from '../../lib/attendance/format';
import { summariseMonth } from '../../lib/attendance/summary';

// Four headline figures above the month grid (Stitch "Timesheet" KPI row). The
// design's allowance / slot-adherence tiles are not built: they depend on the
// fixed-tier and ₹450 allowance model that was ruled out for this product.
export default function MonthSummaryStrip({ days }: { days: AttendanceDayRow[] }) {
  const s = summariseMonth(days);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Worked" value={formatWorkedMinutes(s.workedMinutes)} hint="this month" />
      <Tile label="Present days" value={String(s.presentDays)} hint="incl. WFH and half days" tone="success" />
      <Tile label="Late arrivals" value={String(s.lateDays)} hint="days" tone={s.lateDays > 0 ? 'due' : 'neutral'} />
      <Tile label="Needs attention" value={String(s.attentionDays)} hint="absent / missed punch" tone={s.attentionDays > 0 ? 'overdue' : 'neutral'} />
    </div>
  );
}

const ACCENT = {
  neutral: 'bg-outline-variant',
  success: 'bg-status-success',
  due: 'bg-status-due',
  overdue: 'bg-status-overdue',
} as const;

function Tile({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint: string; tone?: keyof typeof ACCENT }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm sm:p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${ACCENT[tone]}`} aria-hidden="true" />
      <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="mt-1 font-mono text-headline-md font-bold tabular-nums text-on-surface">{value}</p>
      <p className="text-label-sm text-on-surface-variant">{hint}</p>
    </div>
  );
}
