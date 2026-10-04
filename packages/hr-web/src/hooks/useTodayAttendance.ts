'use client';

import { useCallback, useEffect, useState } from 'react';
import { attendance as attendanceApi, shiftAssignments as shiftAssignmentsApi } from '../lib/api/client';
import type { AttendanceDayRow, DayEventView, ShiftAssignmentView, TodayPunchState } from '../lib/attendance/types';
import { todayIso } from '../lib/attendance/format';

interface UseTodayAttendanceReturn {
  todayRow: AttendanceDayRow | undefined;
  punchState: TodayPunchState | undefined;
  todayEvents: DayEventView[];
  shift: ShiftAssignmentView | undefined;
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
  const [shift, setShift] = useState<ShiftAssignmentView | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (timezone: string | undefined) => {
      const today = todayIso(timezone);
      const [me, state, events, assignments] = await Promise.allSettled([
        attendanceApi.me(),
        attendanceApi.todayState(),
        attendanceApi.dayEvents({ user_id: userId, date: today }),
        shiftAssignmentsApi.list({ userId }),
      ]);
      if (me.status === 'fulfilled') {
        setMonthDays(me.value.data.days);
        setTodayRow(me.value.data.days.find((d) => d.work_date === today));
      } else {
        setError(me.reason instanceof Error ? me.reason.message : 'Failed to load today’s attendance.');
      }
      setPunchState(state.status === 'fulfilled' ? state.value.data : undefined);
      setTodayEvents(events.status === 'fulfilled' ? events.value.data : []);
      if (assignments.status === 'fulfilled') {
        setShift(
          assignments.value.data.find(
            (a) => a.is_active && a.effective_from <= today && (!a.effective_to || a.effective_to >= today),
          ),
        );
      }
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
