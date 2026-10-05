'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { attendance as attendanceApi, documents, leave as leaveApi, swaps } from '../../lib/api/client';

const POLL_MS = 120_000;

interface Item { id: string; label: string; count: number; href: string }

/**
 * The header bell for HR: what is waiting for THIS person to decide. It is not an event feed. HR events
 * (leave info requested, attendance nudges) are fire-and-forget and nothing stores them, so a feed would miss
 * anything that happened while the tab was closed. The queues themselves are the durable record, so the bell asks
 * them (the same way the Attendance tab's face-review badge does) and every row links to where it is handled.
 * Each queue is asked only if the person holds the capability that decides it; a failed read counts as nothing.
 */
export default function HrAttentionBell({ actor }: { actor: SessionUser }) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    const zero = Promise.resolve(0);
    const total = <T,>(p: Promise<{ total?: number; data: T[] }>) => p.then((r) => r.total ?? r.data.length).catch(() => 0);
    Promise.all([
      can(actor, CAPABILITY.HR_LEAVE_APPROVE) ? total(leaveApi.teamRequests({ status: 'pending', limit: 1 })) : zero,
      can(actor, CAPABILITY.HR_ATTENDANCE_REGULARIZATION_APPROVE) ? total(attendanceApi.regularizations.list({ scope: 'team', status: 'pending', limit: 1 })) : zero,
      can(actor, CAPABILITY.HR_ATTENDANCE_SWAP_APPROVE) ? swaps.queue().then((r) => r.data.length).catch(() => 0) : zero,
      can(actor, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE) ? documents.pending().then((r) => r.data.length).catch(() => 0) : zero,
    ]).then(([lv, rg, sw, dc]) => setItems([
      { id: 'leave', label: 'Leave requests to decide', count: lv, href: '/leave/approvals' },
      { id: 'reg', label: 'Regularization requests', count: rg, href: '/attendance/team' },
      { id: 'swap', label: 'Shift swaps to approve', count: sw, href: '/team' },
      { id: 'docs', label: 'Documents to review', count: dc, href: '/documents' },
    ].filter((i) => i.count > 0)));
  }, [actor]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, refresh]);

  const unread = items.reduce((n, i) => n + i.count, 0);

  return (
    <div className="relative">
      <button ref={buttonRef} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label={`Notifications${unread > 0 ? ` (${unread} waiting)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-status-overdue px-1 text-[10px] font-bold text-on-primary">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div ref={panelRef} className="absolute right-0 top-full z-[100] mt-2 w-80 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-xl sm:w-96">
          <div className="border-b border-outline-variant/60 px-4 py-3">
            <h2 className="text-sm font-semibold text-on-surface">Waiting for you</h2>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-on-surface-variant">You are all caught up.</p>
          ) : (
            <ul className="divide-y divide-outline-variant/50">
              {items.map((i) => (
                <li key={i.id}>
                  <Link href={i.href} onClick={() => setOpen(false)} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-container-low">
                    <span className="text-on-surface">{i.label}</span>
                    <span className="rounded-full bg-status-due-container px-2 py-0.5 font-mono text-xs font-bold text-on-status-due-container">{i.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
