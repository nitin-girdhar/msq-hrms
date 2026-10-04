'use client';

import { useEffect, useState } from 'react';
import { attendanceTools } from '../../lib/api/client';
import type { Nudge } from '../../lib/h7/types';
import { formatClockTime } from '../../lib/attendance/format';

/**
 * A reminder HR sent because you had not punched. Shown on the attendance and home screens for
 * the day it was sent and the next; it carries no action — punching is the answer. Renders
 * nothing when there is none, or when the caller may not read their attendance.
 */
export default function NudgeBanner() {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  useEffect(() => {
    attendanceTools.nudges().then((r) => setNudges(r.data)).catch(() => setNudges([]));
  }, []);
  const latest = nudges[0];
  if (!latest) return null;
  return (
    <div role="status" className="rounded-xl border border-status-due/30 bg-status-due-container px-4 py-3 text-sm text-on-status-due-container">
      <span className="font-semibold">{latest.from_name ?? 'HR'}</span> reminded you at {formatClockTime(latest.created_at)} that you have not punched in. Check in when you are at work.
    </div>
  );
}
