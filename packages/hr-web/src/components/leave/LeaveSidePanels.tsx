'use client';

import { useEffect, useMemo, useState } from 'react';
import { holidays as holidaysApi, leave as leaveApi } from '../../lib/api/client';
import type { HolidayView, LeaveRequestView } from '../../lib/leave/types';
import { formatDateRange } from '../../lib/leave/format';
import PersonAvatar from '../common/PersonAvatar';

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <h3 className="text-base font-semibold text-on-surface">{title}</h3>
      {subtitle && <p className="mb-3 text-xs text-on-surface-variant">{subtitle}</p>}
      {children}
    </section>
  );
}

/** Teammates on approved leave in the next two weeks, so someone can check before they book. Hidden for people who may not see team leave. */
export function TeamAvailabilityCard({ userId }: { userId: string }) {
  const [items, setItems] = useState<LeaveRequestView[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    leaveApi.teamRequests({ status: 'approved', limit: 100 }).then((r) => setItems(r.data)).catch(() => setAllowed(false));
  }, []);
  const from = todayIso();
  const to = addDays(from, 14);
  const away = useMemo(
    () => (items ?? []).filter((r) => r.user_id !== userId && r.start_date <= to && r.end_date >= from).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 8),
    [items, userId, from, to],
  );
  if (!allowed) return null;
  return (
    <Card title="Team availability" subtitle="Teammates away in the next two weeks">
      {items === null ? <p className="text-sm text-on-surface-variant">Loading…</p> : away.length === 0 ? (
        <p className="text-sm text-on-surface-variant">No one on your team is away in the next two weeks.</p>
      ) : (
        <ul className="space-y-2">
          {away.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 rounded-lg bg-surface-container-low px-2.5 py-2">
              <PersonAvatar name={r.user_full_name} userId={r.user_id} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-on-surface">{r.user_full_name}</span>
                <span className="block truncate text-label-sm text-on-surface-variant">{r.leave_type_label} · {formatDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The next few holidays as date tiles with a countdown. */
export function UpcomingHolidaysCard() {
  const [list, setList] = useState<HolidayView[]>([]);
  useEffect(() => {
    holidaysApi.list({ year: new Date().getFullYear() }).then((r) => setList(r.data)).catch(() => setList([]));
  }, []);
  const next = useMemo(() => list.filter((h) => h.is_active && h.holiday_date >= todayIso()).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)).slice(0, 4), [list]);
  const until = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000);
  return (
    <Card title="Upcoming holidays" subtitle="Your branch calendar">
      {next.length === 0 ? <p className="text-sm text-on-surface-variant">No upcoming holidays.</p> : (
        <ul className="space-y-2">
          {next.map((h) => {
            const n = until(h.holiday_date);
            return (
              <li key={h.id} className="flex items-center gap-3 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2">
                <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-primary-fixed py-1 text-on-primary-fixed" aria-hidden="true">
                  <span className="text-[0.625rem] font-semibold uppercase">{new Date(`${h.holiday_date}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                  <span className="font-mono text-base font-bold leading-none">{h.holiday_date.slice(8, 10)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-on-surface">{h.name}</span>
                  <span className="block text-label-sm text-on-surface-variant">{new Date(`${h.holiday_date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}{h.is_optional ? ' · Optional' : ''}</span>
                </span>
                <span className="shrink-0 text-label-sm font-semibold text-on-surface-variant">{n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
