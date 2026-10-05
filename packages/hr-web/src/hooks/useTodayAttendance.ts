'use client';

import { useCallback, useEffect, useState } from 'react';
import { attendance as attendanceApi, attendanceTools } from '../lib/api/client';
import type { AttendanceDayRow, DayEventView, TodayPunchState } from '../lib/attendance/types';
import { ownPunchesOnDate } from '../lib/attendance/sessions';
import { todayIso } from '../lib/attendance/format';

interface UseTodayAttendanceReturn {
  todayRow: AttendanceDayRow | undefined;
  punchState: TodayPunchState | undefined;
  todayEvents: DayEventView[];
  shift: { shift_name: string } | undefined;
  /** The current month's day rows — drives the month summary strip. */
  monthDays: AttendanceDayRow[];
  loading: boolean;
  error: string | null;
}

/**
 * Today's attendance picture for the home dashboard: the same four reads the
 * Attendance page makes (rules for the org timezone, the month, the server's
 * punch gate, today's punches) plus the current shift. Read-only — the punch
 * itself stays on /attendance, where the camera/geofence/face flow lives.
 *
 * Each secondary read degrades on its own (a role without
 * hr.attendance.photo.view loses the per-slot list, nothing else), so one 403
 * never blanks the card.
 */
export function useTodayAttendance(userId: string, enabled: boolean): UseTodayAttendanceReturn {
  const [todayRow, setTodayRow] = useState<AttendanceDayRow | undefined>(undefined);
  const [monthDays, setMonthDays] = useState<AttendanceDayRow[]>([]);
  const [punchState, setPunchState] = useState<TodayPunchState | undefined>(undefined);
  const [todayEvents, setTodayEvents] = useState<DayEventView[]>([]);
  const [shift, setShift] = useState<{ shift_name: string } | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (timezone: string | undefined) => {
      const today = todayIso(timezone);
      const [me, state, events, assignments] = await Promise.allSettled([
        attendanceApi.me(),
        attendanceApi.todayState(),
        attendanceApi.dayEvents({ user_id: userId, date: today }),
        // The caller's own shift for today (attendance.view), so a role that cannot list assignments still sees it.
        attendanceApi.myShift(today),
      ]);
      if (me.status === 'fulfilled') {
        setMonthDays(me.value.data.days);
        setTodayRow(me.value.data.days.find((d) => d.work_date === today));
      } else {
        setError(me.reason instanceof Error ? me.reason.message : 'Failed to load today’s attendance.');
      }
      setPunchState(state.status === 'fulfilled' ? state.value.data : undefined);
      if (events.status === 'fulfilled') {
        setTodayEvents(events.value.data);
      } else {
        // No photo-view capability: fall back to the caller's own punch log, which needs only attendance.view.
        const own = await attendanceTools.punches(today.slice(0, 7)).then((r) => ownPunchesOnDate(r.data, today, timezone)).catch(() => []);
        setTodayEvents(own);
      }
      setShift(assignments.status === 'fulfilled' && assignments.value.data ? { shift_name: assignments.value.data.shift_name } : undefined);
    },
    [userId],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    attendanceApi
      .getRules()
      .then((res) => res.data.timezone)
      .catch(() => undefined)
      .then(async (timezone) => {
        if (!active) return;
        await load(timezone);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, load]);

  return { todayRow, punchState, todayEvents, shift, monthDays, loading, error };
}
