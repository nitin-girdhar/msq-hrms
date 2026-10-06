'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { can, CAPABILITY } from '@platform/rbac';
import { holidays as holidaysApi, leave as leaveApi, profile as profileApi } from '../../lib/api/client';
import type { EmployeeHeader } from '../../lib/profile/types';
import type { HolidayView, LeaveBalance } from '../../lib/leave/types';
import { canDecideLeave } from '../../lib/leave/format';
import { formatDay, todayIso } from '../../lib/attendance/format';
import { useTodayAttendance } from '../../hooks/useTodayAttendance';
import TodayCard from '../attendance/TodayCard';
import MonthSummaryStrip from '../attendance/MonthSummaryStrip';
import { Avatar, LeaveBalanceCard } from '../profile/ProfileParts';
import StatCard from '../common/StatCard';
import AnnouncementsPanel from './AnnouncementsPanel';
import ActivityPanel from './ActivityPanel';
import SlotLog from '../attendance/SlotLog';
import NudgeBanner from '../attendance/NudgeBanner';
import { emptyBlockCls } from '../../lib/ui';

interface Props {
  actor: SessionUser;
}

const UPCOMING_LIMIT = 5;

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The HR home screen (Stitch "Employee Dashboard"): who am I today, how is my
 * month going, what leave do I have, what is coming up.
 *
 * Every block is gated by the capability behind it, so a leave-only tenant sees no
 * attendance blocks and vice versa — nothing here is a security boundary (each
 * endpoint enforces its own), it just avoids rendering something the API would 403.
 * Punching stays on /attendance: the hero's button hands off there rather than
 * duplicating the camera/geofence/face flow.
 *
 * Deliberately absent from the design: the announcements feed and activity log
 * (built in phase H6), the "pending tasks" tile (owned by the To-Do product) and
 * the decorative "98.2%" present-rate.
 */
export default function EmployeeDashboardShell({ actor }: Props) {
  const router = useRouter();
  const showAttendance = can(actor, CAPABILITY.HR_ATTENDANCE_VIEW);
  const showLeave = can(actor, CAPABILITY.HR_LEAVE_VIEW);
  const showApprovals = showLeave && canDecideLeave(actor);

  const today = useTodayAttendance(actor.id, showAttendance);

  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [upcoming, setUpcoming] = useState<HolidayView[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [header, setHeader] = useState<EmployeeHeader | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The greeting and date depend on the viewer's clock and time zone, which the server cannot know: render them after mount, not during SSR (a mismatch is a hydration error).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  // The profile card is a nicety: people without a profile (or without the capability) simply do not get it.
  useEffect(() => {
    if (!can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT)) return;
    profileApi.mine().then((r) => setHeader(r.data.header)).catch(() => setHeader(null));
  }, [actor]);

  useEffect(() => {
    if (!showLeave) return;
    leaveApi.balances().then((res) => setBalances(res.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load leave balances.'));
    const year = new Date().getFullYear();
    // This year's list is enough: late December shows only what is left of the year.
    holidaysApi.list({ year }).then((res) => setUpcoming(res.data)).catch(() => setUpcoming([]));
  }, [showLeave]);

  useEffect(() => {
    if (!showApprovals) return;
    leaveApi
      .teamRequests({ status: 'pending', limit: 1 })
      .then((res) => setPendingApprovals(res.total))
      .catch(() => setPendingApprovals(null));
  }, [showApprovals]);

  const nextHolidays = useMemo(() => {
    const iso = todayIso();
    return upcoming
      .filter((h) => h.is_active && h.holiday_date >= iso)
      .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
      .slice(0, UPCOMING_LIMIT);
  }, [upcoming]);

  const first = (actor.name || actor.email || '').split(' ')[0];
  const nothingEnabled = !showAttendance && !showLeave;
  const name = header?.full_name || actor.name || actor.email;

  // Month numbers, counted from the day rows already fetched for the strip.
  const presentDays = today.monthDays.filter((d) => ['present', 'wfh', 'half_day'].includes(d.status_name)).length;
  const lateDays = today.monthDays.filter((d) => d.is_late).length;
  const leaveLeft = Math.round(balances.reduce((n, b) => n + (b.balance > 0 ? b.balance : 0), 0) * 10) / 10;

  const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000);

  // Shortcuts to the screens this person may open; a tile for something they cannot use would only 403 or redirect.
  const shortcuts = [
    showLeave && { href: '/leave', label: 'Apply leave', sub: 'Time off' },
    showAttendance && { href: '/attendance', label: 'Attendance', sub: 'Punch and timesheet' },
    can(actor, CAPABILITY.HR_EMPLOYEES_PAYSLIP_VIEW) && { href: '/payroll', label: 'Payslips', sub: 'Pay and deductions' },
    can(actor, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW) && { href: '/documents', label: 'My documents', sub: 'HR and tax' },
    can(actor, CAPABILITY.HR_ATTENDANCE_ROSTER_VIEW) && { href: '/team', label: 'Team roster', sub: 'Shifts and swaps' },
    can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT) && { href: '/profile', label: 'My profile', sub: 'Details and contacts' },
  ].filter((x): x is { href: string; label: string; sub: string } => Boolean(x));

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title={now ? `${greeting(now.getHours())}${first ? `, ${first}` : ''}` : `Welcome${first ? `, ${first}` : ''}`}
        subtitle={now ? now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ' '}
      />

      <PageBody>
        {(error || today.error) && <Alert tone="error">{error ?? today.error}</Alert>}
        {nothingEnabled && <p className={emptyBlockCls}>Nothing is enabled for your role here yet.</p>}

        {showAttendance && <NudgeBanner />}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <section className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Avatar name={name} userId={actor.id} />
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-on-surface">{name}</p>
                <p className="truncate text-sm font-medium text-primary">{[header?.designation_name, header?.department_name].filter(Boolean).join(' · ') || actor.role_label || '—'}</p>
                {header?.employee_code && <p className="font-mono text-label-sm text-on-surface-variant">{header.employee_code}</p>}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Email', actor.email],
                ['Phone', header?.mobile],
                ['Branch', actor.org_name],
                ['Reports to', header?.manager_name ?? actor.manager_name],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-surface-container-low px-2.5 py-2">
                  <dt className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{k}</dt>
                  <dd className="truncate font-medium text-on-surface" title={v ?? ''}>{v || '—'}</dd>
                </div>
              ))}
            </dl>
            {today.shift && (
              <p className="rounded-lg bg-primary-fixed/50 px-3 py-2 text-xs text-on-primary-fixed">
                Shift today: <strong>{today.shift.shift_name}</strong>
              </p>
            )}
          </section>

          {showAttendance ? (
            <TodayCard
              todayRow={today.todayRow}
              shift={today.shift}
              punchState={today.punchState}
              todayEvents={today.todayEvents}
              onPunch={() => router.push('/attendance')}
              busy={today.loading}
            />
          ) : <div />}
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {showAttendance && <StatCard label="Present days" value={presentDays} tone="success" hint="this month" />}
          {showAttendance && <StatCard label="Late arrivals" value={lateDays} tone={lateDays > 0 ? 'due' : 'neutral'} hint={lateDays === 1 ? 'day this month' : 'days this month'} />}
          {showLeave && <StatCard label="Leave available" value={leaveLeft} tone="info" hint="days across all types" />}
          {showApprovals && pendingApprovals != null && (
            <StatCard label="Waiting for you" value={pendingApprovals} tone={pendingApprovals > 0 ? 'overdue' : 'neutral'} hint="leave requests to decide"
              action={pendingApprovals > 0 ? <Link href="/leave/approvals" className="text-xs font-semibold text-primary hover:underline">Review →</Link> : undefined} />
          )}
        </div>

        {/* A split shift already lists its slots inside the Today card; this section is for every other shift. */}
        {showAttendance && today.todayEvents.length > 0 && !today.punchState?.is_split && (
          <PageSection title="Today's slots">
            <SlotLog segments={today.punchState?.segments ?? []} events={today.todayEvents} />
          </PageSection>
        )}

        {showAttendance && today.monthDays.length > 0 && (
          <PageSection title="This month">
            <MonthSummaryStrip days={today.monthDays} />
          </PageSection>
        )}

        {shortcuts.length > 0 && (
          <PageSection title="Quick actions">
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {shortcuts.map((q) => (
                <li key={q.href}>
                  <Link href={q.href} className="flex h-full flex-col gap-0.5 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm transition-colors hover:border-primary hover:bg-primary-fixed/30">
                    <span className="text-sm font-semibold text-on-surface">{q.label}</span>
                    <span className="text-label-sm text-on-surface-variant">{q.sub}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </PageSection>
        )}

        {showLeave && (
          <div className="grid gap-4 lg:grid-cols-2">
            <LeaveBalanceCard balances={balances.map((b) => ({ leave_type_label: b.leave_type_label, balance: b.balance }))} />
            <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
              <header className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-on-surface">Upcoming holidays</h3>
                  <p className="text-xs text-on-surface-variant">Your branch calendar</p>
                </div>
              </header>
              {nextHolidays.length === 0 ? (
                <p className="text-sm text-on-surface-variant">No upcoming holidays.</p>
              ) : (
                <ul className="space-y-2">
                  {nextHolidays.map((h) => {
                    const n = daysUntil(h.holiday_date);
                    return (
                      <li key={h.id} className="flex items-center gap-3 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2">
                        <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-primary-fixed py-1 text-on-primary-fixed" aria-hidden="true">
                          <span className="text-[0.625rem] font-semibold uppercase">{new Date(`${h.holiday_date}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                          <span className="font-mono text-lg font-bold leading-none">{h.holiday_date.slice(8, 10)}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-on-surface">{h.name}</span>
                          <span className="block text-label-sm text-on-surface-variant">
                            {new Date(`${h.holiday_date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}
                            {h.is_optional ? ' · Optional' : ' · Holiday'}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-surface-container px-2 py-0.5 text-label-sm font-semibold text-on-surface-variant">
                          {n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}

        <ActivityPanel />

        {can(actor, CAPABILITY.HR_EMPLOYEES_ANNOUNCEMENTS_VIEW) && <AnnouncementsPanel actor={actor} onError={setError} />}
      </PageBody>
    </div>
  );
}
