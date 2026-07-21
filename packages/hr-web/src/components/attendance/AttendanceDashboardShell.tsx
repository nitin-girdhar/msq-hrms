'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { attendance as attendanceApi, shiftAssignments as shiftAssignmentsApi } from '../../lib/api/client';
import type { AttendanceDayRow, AttendanceRules, PunchResult, RegularizationView, ShiftAssignmentView } from '../../lib/attendance/types';
import { todayIso } from '../../lib/attendance/format';
import type { HrRank } from '../../lib/hr-rank';
import AttendanceTabs from './AttendanceTabs';
import TodayCard from './TodayCard';
import PunchModal from './PunchModal';
import MyMonthCalendar from './MyMonthCalendar';
import DayDetailPopover from './DayDetailPopover';
import RegularizationFormModal from './RegularizationFormModal';
import MyRegularizationsList from './MyRegularizationsList';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

export default function AttendanceDashboardShell({ actor, hrRank }: Props) {
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
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="My Attendance"
        subtitle="Check in/out, your monthly calendar, and regularization requests."
        tabs={<AttendanceTabs hrRank={hrRank} />}
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <TodayCard todayRow={todayRow} shift={shift} onPunch={(mode) => { setPunchMode(mode); setNotice(null); }} busy={punchMode !== null} />

        <PageSection title="My month">
          <MyMonthCalendar
            refreshKey={refreshKey}
            onDayClick={(row, date) => { setDetailRow(row); setDetailDate(date); }}
          />
        </PageSection>

        <PageSection title="My regularizations">
          <MyRegularizationsList items={regularizations} loading={regLoading} />
        </PageSection>
      </PageBody>

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
