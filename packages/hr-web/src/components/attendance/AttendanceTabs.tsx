'use client';

import type { SessionUser } from '@platform/types';
import { PageTabs, type PageTab } from '@platform/ui-kit';
import type { HrRank } from '../../lib/hr-rank';
import { canViewTeamAttendance } from '@hr/authz';
import { canReviewFaceMatches } from '../../lib/attendance/format';
import { usePendingFaceReviews } from '../../hooks/usePendingFaceReviews';

interface Props {
  // The caller's resolved rank on the unified iam ladder. See lib/hr-rank.ts.
  hrRank: HrRank;
  // Carries the DB-resolved capability list that decides which tabs exist.
  actor: SessionUser;
}

// In-page sub-navigation for the Attendance module. Renders inside PageHeader's
// band so the underline sits on the band's own edge-to-edge rule.
export default function AttendanceTabs({ hrRank, actor }: Props) {
  // Only reviewers get the count, and the endpoint is theirs to call — asking as
  // anyone else would 403 on every poll.
  const { count: pendingFaceReviews } = usePendingFaceReviews(canReviewFaceMatches(actor));

  const tabs: PageTab[] = [
    { href: '/attendance', label: 'Dashboard', exact: true },
  ];
  // Tier C3: a tab exists when the DB grants the capability behind it — the same
  // list hr-service gates on. Previously unconditional, on the incorrect
  // assumption that the backend returns an empty view; it throws instead.
  if (canViewTeamAttendance(actor)) {
    // The badge is the only thing that tells a manager a punch is waiting: the
    // face_review_pending event is published but nothing consumes or stores it,
    // so without this a flagged punch sits unexamined and uncredited.
    tabs.push({ href: '/attendance/team', label: 'Team', badge: pendingFaceReviews });
  }

  return <PageTabs tabs={tabs} label="Attendance sections" />;
}
