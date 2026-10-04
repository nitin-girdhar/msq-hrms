'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { can, CAPABILITY } from '@platform/rbac';
import { holidays as holidaysApi, leave as leaveApi } from '../../lib/api/client';
import type { HolidayView, LeaveBalance } from '../../lib/leave/types';
import { canDecideLeave } from '../../lib/leave/format';
import { formatDay, todayIso } from '../../lib/attendance/format';
import { useTodayAttendance } from '../../hooks/useTodayAttendance';
import TodayCard from '../attendance/TodayCard';
import MonthSummaryStrip from '../attendance/MonthSummaryStrip';
import BalanceCards from '../leave/BalanceCards';
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
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title={`${greeting(new Date().getHours())}${first ? `, ${first}` : ''}`}
        subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />

      <PageBody>
        {(error || today.error) && <Alert tone="error">{error ?? today.error}</Alert>}
        {nothingEnabled && <p className={emptyBlockCls}>Nothing is enabled for your role here yet.</p>}

        {showAttendance && (
          <TodayCard
            todayRow={today.todayRow}
            shift={today.shift}
            punchState={today.punchState}
            todayEvents={today.todayEvents}
            onPunch={() => router.push('/attendance')}
            busy={today.loading}
          />
        )}

        {showAttendance && today.monthDays.length > 0 && (
          <PageSection title="This month">
            <MonthSummaryStrip days={today.monthDays} />
          </PageSection>
        )}

        {showApprovals && pendingApprovals != null && pendingApprovals > 0 && (
          <button
            type="button"
            onClick={() => router.push('/leave/approvals')}
            className="flex items-center justify-between gap-3 rounded-xl border border-status-due/30 bg-status-due-container px-4 py-3 text-left shadow-sm transition-colors hover:bg-status-due-container/70"
          >
            <span className="text-sm font-semibold text-on-status-due-container">
              {pendingApprovals} leave request{pendingApprovals === 1 ? '' : 's'} waiting for your decision
            </span>
            <span className="text-xs font-semibold text-on-status-due-container">Review →</span>
          </button>
        )}

        {showLeave && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <PageSection title="Leave balance">
                <BalanceCards balances={balances} />
              </PageSection>
            </div>
            <PageSection title="Upcoming holidays">
              {nextHolidays.length === 0 ? (
                <p className={emptyBlockCls}>No upcoming holidays.</p>
              ) : (
                <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
                  {nextHolidays.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0 truncate text-sm font-medium text-on-surface">{h.name}</span>
                      <span className="shrink-0 text-right text-xs text-on-surface-variant">
                        {formatDay(h.holiday_date)}
                        {h.is_optional && <span className="ml-1.5 rounded-full bg-surface-container px-1.5 py-0.5 text-label-sm">Optional</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </PageSection>
          </div>
        )}
      </PageBody>
    </div>
  );
}
