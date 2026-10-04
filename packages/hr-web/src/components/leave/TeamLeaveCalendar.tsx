'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonthGrid, type MonthGridBar, type MonthGridMarker } from '@platform/ui-kit';
import { leave as leaveApi, holidays as holidaysApi } from '../../lib/api/client';
import type { LeaveRequestView, HolidayView } from '../../lib/leave/types';

// Deterministic bar color per leave type (soft, readable palette).
// CSS variables, not hex: the brand colour follows the tenant, the rest are the fixed categorical hues.
const PALETTE = ['var(--color-primary)', 'var(--color-cat-purple)', 'var(--color-cat-cyan)', 'var(--color-cat-pink)', 'var(--color-status-success)', 'var(--color-cat-orange)'];
function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function firstName(full: string): string {
  return full.split(' ')[0] ?? full;
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  for (let t = s; t <= e; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export default function TeamLeaveCalendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [requests, setRequests] = useState<LeaveRequestView[]>([]);
  const [orgHolidays, setOrgHolidays] = useState<HolidayView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    Promise.all([
      // 100 is the backend's validated max (leave.schema.ts) for one org/month.
      leaveApi.teamRequests({ status: 'approved', from, to, limit: 100 }),
      holidaysApi.list({ year }),
    ])
      .then(([req, hol]) => {
        setRequests(req.data);
        setOrgHolidays(hol.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load calendar.'));
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const bars = useMemo<MonthGridBar[]>(() => {
    const out: MonthGridBar[] = [];
    for (const r of requests) {
      for (const d of eachDate(r.start_date, r.end_date)) {
        if (!d.startsWith(monthPrefix)) continue;
        out.push({
          date: d,
          label: firstName(r.user_full_name),
          color: colorFor(r.leave_type_name),
          title: `${r.user_full_name} — ${r.leave_type_label}`,
        });
      }
    }
    return out;
  }, [requests, monthPrefix]);

  const markers = useMemo<MonthGridMarker[]>(
    () =>
      orgHolidays
        .filter((h) => h.holiday_date.startsWith(monthPrefix) && !h.is_optional)
        .map((h) => ({ date: h.holiday_date, label: h.name })),
    [orgHolidays, monthPrefix],
  );

  return (
    <div className="space-y-2">
      {error && <div className="rounded-lg border border-status-overdue/30 bg-status-overdue-container px-4 py-2 text-xs text-on-status-overdue-container">{error}</div>}
      <MonthGrid
        year={year}
        month={month}
        bars={bars}
        markers={markers}
        onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
      />
    </div>
  );
}
