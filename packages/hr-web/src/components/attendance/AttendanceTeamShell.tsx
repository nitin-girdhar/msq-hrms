'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { FaceReviewView, RegularizationView, TeamDayRow } from '../../lib/attendance/types';
import { canManageAttendanceAdmin, canReviewFaceMatches, todayIso } from '../../lib/attendance/format';
import type { HrRank } from '../../lib/hr-rank';
import AttendanceTabs from './AttendanceTabs';
import TeamDayView from './TeamDayView';
import RegularizationQueue from './RegularizationQueue';
import RegularizationDecisionModal from './RegularizationDecisionModal';
import FaceReviewQueue from './FaceReviewQueue';
import FaceReviewDecisionModal from './FaceReviewDecisionModal';
import { notifyFaceReviewsChanged } from '../../hooks/usePendingFaceReviews';
import { can, CAPABILITY } from '@platform/rbac';
import { ManualPunchModal, RosterToolbar } from './RosterTools';

interface Props {
  actor: SessionUser;
  hrRank: HrRank;
}

export default function AttendanceTeamShell({ actor, hrRank }: Props) {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<TeamDayRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [pending, setPending] = useState<RegularizationView[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<RegularizationView | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [faceReviews, setFaceReviews] = useState<FaceReviewView[]>([]);
  const [faceReviewsLoading, setFaceReviewsLoading] = useState(true);
  const [reviewingFace, setReviewingFace] = useState<FaceReviewView | null>(null);
  const canOverride = can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN_OVERRIDE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [punching, setPunching] = useState<TeamDayRow | null>(null);

  const canManage = canManageAttendanceAdmin(actor);
  const canReviewFaces = canReviewFaceMatches(actor);
  const showFaceReviews = faceEnabled && canReviewFaces;

  useEffect(() => {
    attendanceApi.getRules().then((res) => setFaceEnabled(res.data.require_face_match)).catch(() => setFaceEnabled(false));
  }, []);

  const loadRows = useCallback(() => {
    setRowsLoading(true);
    attendanceApi
      .team({ date })
      .then((res) => setRows(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the team view.'))
      .finally(() => setRowsLoading(false));
  }, [date]);

  const loadPending = useCallback(() => {
    setPendingLoading(true);
    attendanceApi.regularizations
      .list({ scope: 'team', status: 'pending', limit: 100 })
      .then((res) => setPending(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the approval queue.'))
      .finally(() => setPendingLoading(false));
  }, []);

  const loadFaceReviews = useCallback(() => {
    if (!showFaceReviews) {
      setFaceReviews([]);
      setFaceReviewsLoading(false);
      return;
    }
    setFaceReviewsLoading(true);
    attendanceApi.faceReviews
      .list({ status: 'pending', limit: 100 })
      .then((res) => setFaceReviews(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the face-review queue.'))
      .finally(() => setFaceReviewsLoading(false));
  }, [showFaceReviews]);

  // A different day is a different list: a selection must not follow you across dates.
  useEffect(() => { setSelected(new Set()); }, [date]);
  useEffect(() => { loadRows(); }, [loadRows]);
  useEffect(() => { loadPending(); }, [loadPending]);
  useEffect(() => { loadFaceReviews(); }, [loadFaceReviews]);

  const handleDecided = (message: string) => {
    setNotice(message);
    loadPending();
    // A regularization rewrites the day, so the grid behind it is now stale.
    loadRows();
  };

  const handleFaceDecided = (message: string) => {
    setNotice(message);
    loadFaceReviews();
    // Both decisions recompute worked_minutes — without this the grid would
    // contradict the decision the reviewer just made.
    loadRows();
    // And the tab badge, which polls on its own two-minute cycle.
    notifyFaceReviewsChanged();
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader
        title="Team Attendance"
        subtitle="Who’s in, who’s out, and pending regularization requests."
        tabs={<AttendanceTabs hrRank={hrRank} actor={actor} />}
      />

      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <PageSection
          title="Day view"
          action={
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Select date"
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          }
        >
          <div className="space-y-3">
            {canOverride && rows.length > 0 && (
              <RosterToolbar
                rows={rows}
                date={date}
                selected={selected}
                onClear={() => setSelected(new Set())}
                onDone={(m) => { setNotice(m); setError(null); loadRows(); }}
                onError={(m) => { setError(m); setNotice(null); }}
              />
            )}
            <TeamDayView
              rows={rows}
              loading={rowsLoading}
              faceEnabled={faceEnabled}
              canManage={canManage}
              onChanged={loadRows}
              {...(canOverride ? {
                tools: {
                  selected,
                  onToggle: (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
                  onToggleAll: (ids: string[]) => setSelected((prev) => (ids.every((i) => prev.has(i)) ? new Set() : new Set(ids))),
                  onManualPunch: setPunching,
                },
              } : {})}
            />
          </div>
        </PageSection>

        {/* Deciding is hr.attendance.regularization.approve; without it the queue is a list of things you cannot act on. */}
        {canReviewFaces && (
          <PageSection title={`Pending regularizations (${pending.length})`}>
            <RegularizationQueue items={pending} loading={pendingLoading} onReview={(r) => { setReviewing(r); setNotice(null); }} />
          </PageSection>
        )}

        {showFaceReviews && (
          <PageSection title={`Pending face reviews (${faceReviews.length})`}>
            <FaceReviewQueue
              items={faceReviews}
              loading={faceReviewsLoading}
              onReview={(r) => { setReviewingFace(r); setNotice(null); }}
            />
          </PageSection>
        )}
      </PageBody>

      {punching && (
        <ManualPunchModal row={punching} date={date} onClose={() => setPunching(null)} onDone={(m) => { setPunching(null); setNotice(m); loadRows(); }} />
      )}
      <RegularizationDecisionModal request={reviewing} onClose={() => setReviewing(null)} onDecided={handleDecided} />
      <FaceReviewDecisionModal review={reviewingFace} onClose={() => setReviewingFace(null)} onDecided={handleFaceDecided} />
    </div>
  );
}
