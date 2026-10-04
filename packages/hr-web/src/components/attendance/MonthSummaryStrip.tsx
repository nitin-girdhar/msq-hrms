import type { AttendanceDayRow } from '../../lib/attendance/types';
import { formatWorkedMinutes } from '../../lib/attendance/format';
import { monthTargets, summariseMonth } from '../../lib/attendance/summary';

interface Calendar {
  year: number;
  month: number;
  weeklyOff: readonly number[];
  holidays: readonly string[];
  today: string;
  fullDayMinutes: number;
}

// Headline figures above the month grid (Stitch "Timesheet" KPI row). Worked-vs-target and the attendance
// rate come from the same day rows as the grid plus the month's weekly offs and holidays, so the strip
// cannot disagree with the grid beneath it. The design's night-allowance tile is not built: it depends on
// an allowance model that was ruled out for now.
export default function MonthSummaryStrip({ days, calendar }: { days: AttendanceDayRow[]; calendar?: Calendar | undefined }) {
  const s = summariseMonth(days);
  const t = calendar ? monthTargets(calendar) : null;
  const rate = t && t.elapsedWorkingDays > 0 ? Math.round((s.presentDays / t.elapsedWorkingDays) * 1000) / 10 : null;
  return (
    <div className={`grid grid-cols-2 gap-3 ${t ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      <Tile label="Worked" value={formatWorkedMinutes(s.workedMinutes)}
        hint={t ? `of ${formatWorkedMinutes(t.targetMinutes)} target to date` : 'this month'}
        tone={t && t.targetMinutes > 0 && s.workedMinutes >= t.targetMinutes ? 'success' : 'neutral'} />
      <Tile label="Present days" value={String(s.presentDays)} hint={t ? `of ${t.elapsedWorkingDays} working days so far` : 'incl. WFH and half days'} tone="success" />
      {t && <Tile label="Attendance rate" value={rate === null ? '—' : `${rate}%`} hint={`${t.workingDays} working days this month`} tone={rate !== null && rate < 90 ? 'due' : 'success'} />}
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
