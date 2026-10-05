'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { myActivity, type ActivityItem } from '../../lib/api/client';

const TONE: Record<ActivityItem['kind'], string> = {
  punch: 'bg-primary-fixed text-on-primary-fixed',
  regularization: 'bg-status-info-container text-on-status-info-container',
  leave: 'bg-status-success-container text-on-status-success-container',
  payslip: 'bg-status-due-container text-on-status-due-container',
  document: 'bg-surface-container text-on-surface-variant',
};
const LETTER: Record<ActivityItem['kind'], string> = { punch: 'P', regularization: 'R', leave: 'L', payslip: '₹', document: 'D' };

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * "Recent activity" on the Home dashboard (Stitch): the signed-in person's own last few events, punches, leave
 * decisions, regularizations, payslips and document reviews. The server returns only their rows, and only the
 * sources their capabilities allow, so this renders whatever comes back and nothing else. A failed read hides the
 * panel rather than raising an error on the home screen.
 */
export default function ActivityPanel() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  // Relative times depend on the viewer's clock: computed after mount so SSR and hydration agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    myActivity.list().then((r) => setItems(r.data)).catch(() => setItems([]));
  }, []);

  if (items === null || items.length === 0) return null;
  return (
    <section aria-label="Recent activity" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
      <h3 className="mb-3 text-base font-semibold text-on-surface">Recent activity</h3>
      <ul className="space-y-1">
        {items.map((i, n) => (
          <li key={`${i.kind}-${i.at}-${n}`}>
            <Link href={i.href} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-container-low">
              <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${TONE[i.kind]}`}>{LETTER[i.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold capitalize text-on-surface">{i.title}</span>
                {i.detail && <span className="block truncate text-label-sm text-on-surface-variant">{i.detail}</span>}
              </span>
              <span className="shrink-0 text-label-sm text-outline">{now ? ago(i.at, now) : ''}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
