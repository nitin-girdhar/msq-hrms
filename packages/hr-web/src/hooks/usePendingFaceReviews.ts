// Count of punches awaiting a face-match decision, for the Attendance tab badge.
//
// Deliberately POLLED rather than pushed. hr-service does publish an
// `attendance:face_review_pending` event, but nothing persists it, so a manager
// who was offline when a punch was flagged would never learn of it. The queue is
// itself the durable record — asking it is what makes the badge survive a logout,
// a reload, or a missed moment.
//
// Flagged punches are not counted toward attendance until someone decides, so an
// unattended badge means an employee is going uncredited as well as a possible
// buddy-punch going unexamined. That is why this refreshes on its own rather than
// waiting for the manager to open the Team page.

import { useCallback, useEffect, useState } from 'react';
import { attendance as attendanceApi } from '../lib/api/client';

// Slow on purpose: this is a "check back" signal, not a live feed, and it runs on
// every attendance page for every manager.
const POLL_MS = 120_000;

// The badge lives in the page tabs while decisions are made in the Team page's
// queue — two components with no common owner. Rather than lift the count through
// three shells, the queue announces a change and any mounted badge re-reads. The
// poll alone would leave the count wrong for up to two minutes immediately after
// the manager's own action, which reads as a bug.
const listeners = new Set<() => void>();

export function notifyFaceReviewsChanged(): void {
  for (const l of listeners) l();
}

export function usePendingFaceReviews(enabled: boolean): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    attendanceApi.faceReviews
      // limit=1 — only `total` is used; the rows are never rendered here.
      .list({ status: 'pending', limit: 1 })
      .then((res) => setCount(res.total))
      // A failed count must not surface an error banner over whatever the manager
      // is actually doing; the Team page reports queue failures properly.
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    refresh();
    if (!enabled) return;
    const id = setInterval(refresh, POLL_MS);
    listeners.add(refresh);
    return () => {
      clearInterval(id);
      listeners.delete(refresh);
    };
  }, [enabled, refresh]);

  return { count, refresh };
}
