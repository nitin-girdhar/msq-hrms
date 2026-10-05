'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection, PhotoUploadModal, users as usersApi } from '@platform/ui-kit';
import { attendance as attendanceApi, attendanceTools } from '../../lib/api/client';
import { ownPunchesOnDate } from '../../lib/attendance/sessions';
import type { AttendanceDayRow, AttendanceRules, DayEventView, FaceSelfContext, PunchResult, RegularizationView, TodayPunchState } from '../../lib/attendance/types';
import { todayIso } from '../../lib/attendance/format';
import type { HrRank } from '../../lib/hr-rank';
import AttendanceTabs from './AttendanceTabs';
import TodayCard from './TodayCard';
import PunchPanel from './PunchPanel';
import MyMonthCalendar from './MyMonthCalendar';
import DayDetailPopover from './DayDetailPopover';
import { useWideScreen } from '../../hooks/useWideScreen';
import RegularizationFormModal from './RegularizationFormModal';
import MyRegularizationsList from './MyRegularizationsList';
import { SlotLogTab, ShiftRegularizationTab } from './TimesheetSlotTabs';
import RegularizationStats from './RegularizationStats';
import PunchLog from './PunchLog';
import NudgeBanner from './NudgeBanner';
import RegularizationDetailModal from './RegularizationDetailModal';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

export default function AttendanceDashboardShell({ actor, hrRank }: Props) {
  const wide = useWideScreen();
  const [rules, setRules] = useState<AttendanceRules | null>(null);
  const [todayRow, setTodayRow] = useState<AttendanceDayRow | undefined>(undefined);
  const [shift, setShift] = useState<{ shift_name: string } | undefined>(undefined);
  const [punchState, setPunchState] = useState<TodayPunchState | undefined>(undefined);
  // Today's individual punches. The day row only carries first_in/last_out, which
  // on a split shift describe no single slot — the Today card pairs these instead.
  const [todayEvents, setTodayEvents] = useState<DayEventView[]>([]);
  const [regularizations, setRegularizations] = useState<RegularizationView[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [monthTab, setMonthTab] = useState<'calendar' | 'log' | 'slots' | 'shiftreg'>('calendar');

  const [punchMode, setPunchMode] = useState<'check_in' | 'check_out' | null>(null);
  const [faceCtx, setFaceCtx] = useState<FaceSelfContext | null>(null);
  const [facePhotoOpen, setFacePhotoOpen] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<AttendanceDayRow | undefined>(undefined);
  const [regFormDate, setRegFormDate] = useState<string | null>(null);
  // Set = the form modal is open in edit mode over this pending request.
  const [regEditing, setRegEditing] = useState<RegularizationView | null>(null);
  // Asking to regularize a day (from the day panel, the header button, or Edit) brings the on-page form into view.
  useEffect(() => {
    if (regFormDate || regEditing) document.getElementById('regularization-inline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [regFormDate, regEditing]);
  const [viewingRegId, setViewingRegId] = useState<string | null>(null);

  // Derive "today" in the org timezone (from rules) so it matches the
  // server-computed work_date. Falls back to browser-local until rules load.
  const orgTz = rules?.timezone;

  const loadToday = useCallback(() => {
    attendanceApi
      .me()
      .then((res) => setTodayRow(res.data.days.find((d) => d.work_date === todayIso(orgTz))))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load today’s status.'));
    // Drives the punch button. Kept separate from the month load because it is
    // the server's own gate decision, not something derivable from the day row.
    attendanceApi
      .todayState()
      .then((res) => setPunchState(res.data))
      .catch(() => setPunchState(undefined));
    // Per-slot times on the Today card. A failure here (e.g. a role without
    // hr.attendance.photo.view) must leave the card standing, so it degrades to
    // no slot list rather than an error — same treatment as in DayDetailPopover.
    attendanceApi
      .dayEvents({ user_id: actor.id, date: todayIso(orgTz) })
      .then((res) => setTodayEvents(res.data))
      .catch(() =>
        // No photo-view capability: the caller's own punch log (attendance.view) carries the same times.
        attendanceTools.punches(todayIso(orgTz).slice(0, 7)).then((r) => setTodayEvents(ownPunchesOnDate(r.data, todayIso(orgTz), orgTz))).catch(() => setTodayEvents([])));
  }, [actor.id, orgTz]);

  const loadShift = useCallback(() => {
    attendanceApi
      .myShift(todayIso(orgTz))
      .then((res) => setShift(res.data ? { shift_name: res.data.shift_name } : undefined))
      .catch(() => setShift(undefined));
  }, [actor.id, orgTz]);

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
    attendanceApi.face.me().then((res) => setFaceCtx(res.data)).catch(() => setFaceCtx(null));
    loadShift();
  }, [loadShift]);

  useEffect(() => { loadToday(); }, [loadToday, refreshKey]);
  useEffect(() => { loadRegularizations(); }, [loadRegularizations, refreshKey]);

  // Check-in gate: when the org enforces face matching, a check-in requires an
  // enrolled reference photo. No photo → prompt upload (then enroll); has photo
  // but not yet enrolled → enroll silently; otherwise proceed. Check-out and
  // face-disabled orgs are never gated.
  const startPunch = useCallback(
    async (mode: 'check_in' | 'check_out') => {
      setNotice(null);
      setError(null);
      if (mode === 'check_out' || !rules?.require_face_match) {
        setPunchMode(mode);
        return;
      }
      let ctx = faceCtx;
      if (!ctx) {
        try {
          ctx = (await attendanceApi.face.me()).data;
          setFaceCtx(ctx);
        } catch {
          setPunchMode(mode); // face status unavailable → let the punch flow decide
          return;
        }
      }
      if (!ctx.has_photo) {
        setFacePhotoOpen(true);
        return;
      }
      if (!ctx.enrolled) {
        setGateBusy(true);
        try {
          await attendanceApi.face.enroll({ user_id: actor.id, consent: true });
          setFaceCtx({ ...ctx, enrolled: true });
          setPunchMode(mode);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not enroll your face. Try again.');
        } finally {
          setGateBusy(false);
        }
        return;
      }
      setPunchMode(mode);
    },
    [rules, faceCtx, actor.id],
  );

  // Upload avatar → enroll → continue to check-in. Consent captured in the modal.
  const handleFacePhotoSubmit = useCallback(
    async (dataUrl: string, consent: boolean) => {
      await usersApi.uploadMyPhoto({ photo: dataUrl, consent });
      await attendanceApi.face.enroll({ user_id: actor.id, consent });
      setFaceCtx((c) => ({
        ...(c ?? {
          user_id: actor.id,
          require_face_match: true,
          cooldown_days: 0,
          can_change_photo: true,
          next_change_allowed_at: null,
        }),
        has_photo: true,
        enrolled: true,
      }));
      setFacePhotoOpen(false);
      setPunchMode('check_in');
    },
    [actor.id],
  );

  const handleCancelRegularization = useCallback(async (item: RegularizationView) => {
    setNotice(null);
    setError(null);
    try {
      await attendanceApi.regularizations.cancel(item.id);
      setNotice('Regularization request cancelled.');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel the request.');
    }
  }, []);

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
        tabs={<AttendanceTabs hrRank={hrRank} actor={actor} />}
        actions={<Button variant="secondary" onClick={() => { setNotice(null); setRegFormDate(todayIso(orgTz)); }}>Regularize a missed punch</Button>}
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <NudgeBanner />

        <TodayCard todayRow={todayRow} shift={shift} punchState={punchState} todayEvents={todayEvents} onPunch={startPunch} busy={punchMode !== null || gateBusy} rules={rules} timezone={orgTz} />

        {/* The punch itself happens here, on the page (selfie + location side by side), not in a pop-up. */}
        {rules && punchMode && (
          <PunchPanel mode={punchMode} rules={rules} geoException={punchState?.geo_exception ?? null} onClose={() => setPunchMode(null)} onSuccess={handlePunchSuccess} />
        )}

        {/* Quick standing, straight under the hero (Stitch): what is waiting, and what was fixed. */}
        {!regLoading && <RegularizationStats items={regularizations} today={todayIso(orgTz)} />}

        <PageSection
          title="My month"
          action={
            <div className="flex gap-1" role="tablist" aria-label="Month view">
              {([['calendar', 'Calendar'], ['log', 'Punch log'], ['slots', 'Slot log'], ['shiftreg', 'Shift regularization']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={monthTab === key} onClick={() => setMonthTab(key)}
                  className={`rounded-full border px-3 py-0.5 text-xs font-semibold transition-colors ${monthTab === key ? 'border-primary bg-primary-fixed text-on-primary-fixed' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {monthTab === 'calendar' ? (
            <div className={wide && detailDate ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start' : ''}>
              <MyMonthCalendar
                refreshKey={refreshKey}
                fullDayMinutes={rules?.min_full_day_minutes}
                today={todayIso(orgTz)}
                onDayClick={(row, date) => { setDetailRow(row); setDetailDate(date); }}
              />
              {wide && detailDate && (
                <DayDetailPopover inline date={detailDate} row={detailRow} userId={actor.id}
                  onClose={() => setDetailDate(null)}
                  onRequestRegularization={(date) => { setDetailDate(null); setRegFormDate(date); }} />
              )}
            </div>
          ) : monthTab === 'log' ? (
            <PunchLog />
          ) : monthTab === 'slots' ? (
            <SlotLogTab today={todayIso(orgTz)} timezone={orgTz} />
          ) : (
            <ShiftRegularizationTab items={regularizations} onNew={() => { setNotice(null); setRegFormDate(todayIso(orgTz)); document.getElementById('regularization-inline')?.scrollIntoView({ behavior: 'smooth' }); }} />
          )}
        </PageSection>

        {/* The correction form sits on the page (Stitch): a missed punch is fixed here, not in a pop-up. */}
        <RegularizationFormModal
          inline
          open
          date={regFormDate}
          item={regEditing}
          rules={rules}
          onClose={() => { setRegFormDate(null); setRegEditing(null); }}
          onSubmitted={() => {
            setNotice(regEditing ? 'Regularization request updated.' : 'Regularization request submitted.');
            setRefreshKey((k) => k + 1);
          }}
        />

        <PageSection title="Regularization history & audit trail">
          <MyRegularizationsList
            items={regularizations}
            loading={regLoading}
            onView={(item) => setViewingRegId(item.id)}
            onEdit={(item) => { setNotice(null); setRegEditing(item); }}
            onCancel={handleCancelRegularization}
          />
        </PageSection>
      </PageBody>

      <PhotoUploadModal
        open={facePhotoOpen}
        onClose={() => setFacePhotoOpen(false)}
        title="Add your photo to check in"
        consentLabel="I consent to my photo being stored and used to verify my attendance."
        onSubmit={handleFacePhotoSubmit}
      />

      <DayDetailPopover
        date={wide ? null : detailDate}
        row={detailRow}
        userId={actor.id}
        onClose={() => setDetailDate(null)}
        onRequestRegularization={(date) => { setDetailDate(null); setRegFormDate(date); }}
      />

      <RegularizationDetailModal regularizationId={viewingRegId} onClose={() => setViewingRegId(null)} />
    </div>
  );
}
