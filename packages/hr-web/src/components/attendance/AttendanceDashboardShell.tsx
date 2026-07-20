'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@crm/types';
import { attendance as attendanceApi, shiftAssignments as shiftAssignmentsApi } from '../../lib/api/client';
import type { AttendanceDayRow, AttendanceRules, PunchResult, RegularizationView, ShiftAssignmentView } from '../../lib/attendance/types';
import { todayIso } from '../../lib/attendance/format';
import AttendanceTabs from './AttendanceTabs';
import TodayCard from './TodayCard';
import PunchModal from './PunchModal';
import MyMonthCalendar from './MyMonthCalendar';
import DayDetailPopover from './DayDetailPopover';
import RegularizationFormModal from './RegularizationFormModal';
import MyRegularizationsList from './MyRegularizationsList';

interface Props {
  actor: SessionUser;
}

export default function AttendanceDashboardShell({ actor }: Props) {
  const [rules, setRules] = useState<AttendanceRules | null>(null);
  const [todayRow, setTodayRow] = useState<AttendanceDayRow | undefined>(undefined);
  const [shift, setShift] = useState<ShiftAssignmentView | undefined>(undefined);
  const [regularizations, setRegularizations] = useState<RegularizationView[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [punchMode, setPunchMode] = useState<'check_in' | 'check_out' | null>(null);
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<AttendanceDayRow | undefined>(undefined);
  const [regFormDate, setRegFormDate] = useState<string | null>(null);

  const loadToday = useCallback(() => {
    attendanceApi
      .me()
      .then((res) => setTodayRow(res.data.days.find((d) => d.work_date === todayIso())))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load today’s status.'));
  }, []);

  const loadShift = useCallback(() => {
    shiftAssignmentsApi
      .list({ userId: actor.id })
      .then((res) => {
        const today = todayIso();
        const current = res.data.find(
          (a) => a.is_active && a.effective_from <= today && (!a.effective_to || a.effective_to >= today),
        );
        setShift(current);
      })
      .catch(() => setShift(undefined));
  }, [actor.id]);

  const loadRegularizations = useCallback(() => {
    setRegLoading(true);
    attendanceApi.regularizations
      .list({ scope: 'own', limit: 50 })
      .then((res) => setRegularizations(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load regularizations.'))
      .finally(() => setRegLoading(false));
  }, []);

  useEffect(() => {
    attendanceApi
      .getRules()
      .then((res) => setRules(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load attendance rules.'));
    loadShift();
  }, [loadShift]);

  useEffect(() => { loadToday(); }, [loadToday, refreshKey]);
  useEffect(() => { loadRegularizations(); }, [loadRegularizations, refreshKey]);

  const handlePunchSuccess = (result: PunchResult) => {
    setNotice(result.event_type === 'check_in' ? 'Checked in.' : 'Checked out.');
    setPunchMode(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="w-full space-y-6 px-3 py-4 sm:px-4">
      <AttendanceTabs actor={actor} />

      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">My Attendance</h1>
        <p className="mt-1 text-sm text-[#64748B]">Check in/out, your monthly calendar, and regularization requests.</p>
      </div>

      {notice && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-700">{notice}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      <TodayCard todayRow={todayRow} shift={shift} onPunch={(mode) => { setPunchMode(mode); setNotice(null); }} busy={punchMode !== null} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0b6cbf]">My month</h2>
        <MyMonthCalendar
          refreshKey={refreshKey}
          onDayClick={(row, date) => { setDetailRow(row); setDetailDate(date); }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0b6cbf]">My regularizations</h2>
        <MyRegularizationsList items={regularizations} loading={regLoading} />
      </section>

      {rules && punchMode && (
        <PunchModal
          open={punchMode !== null}
          mode={punchMode}
          rules={rules}
          onClose={() => setPunchMode(null)}
          onSuccess={handlePunchSuccess}
        />
      )}

      <DayDetailPopover
        date={detailDate}
        row={detailRow}
        onClose={() => setDetailDate(null)}
        onRequestRegularization={(date) => { setDetailDate(null); setRegFormDate(date); }}
      />

      <RegularizationFormModal
        open={regFormDate !== null}
        date={regFormDate}
        onClose={() => setRegFormDate(null)}
        onSubmitted={() => { setNotice('Regularization request submitted.'); setRefreshKey((k) => k + 1); }}
      />
    </div>
  );
}
