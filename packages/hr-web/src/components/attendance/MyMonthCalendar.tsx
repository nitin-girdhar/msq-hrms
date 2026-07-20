'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonthGrid, type MonthGridBar, type MonthGridMarker } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { AttendanceDayRow, MyMonthResponse } from '../../lib/attendance/types';
import { ATTENDANCE_STATUS_STYLES } from '../../lib/attendance/format';

interface Props {
  onDayClick: (row: AttendanceDayRow | undefined, date: string) => void;
  /** bumped by the parent after a successful punch/regularization to force a refetch */
  refreshKey: number;
}

export default function MyMonthCalendar({ onDayClick, refreshKey }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [data, setData] = useState<MyMonthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    attendanceApi
      .me({ month: monthStr })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your calendar.'));
  }, [year, month]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const daysByDate = useMemo(() => {
    const m = new Map<string, AttendanceDayRow>();
    for (const d of data?.days ?? []) m.set(d.work_date, d);
    return m;
  }, [data]);

  const bars = useMemo<MonthGridBar[]>(() => {
    return (data?.days ?? []).map((d) => {
      const style = ATTENDANCE_STATUS_STYLES[d.status_name] ?? ATTENDANCE_STATUS_STYLES.not_marked;
      return {
        date: d.work_date,
        label: d.is_late ? `${d.status_label} · Late` : d.status_label,
        color: style.dot,
        title: `${d.status_label}${d.is_late ? ' (late)' : ''}`,
      };
    });
  }, [data]);

  const markers = useMemo<MonthGridMarker[]>(
    () => (data?.holidays ?? []).map((h) => ({ date: h.d, label: h.name })),
    [data],
  );

  return (
    <div className="space-y-2">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}
      <MonthGrid
        year={year}
        month={month}
        bars={bars}
        markers={markers}
        onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
        onDayClick={(date) => onDayClick(daysByDate.get(date), date)}
      />
    </div>
  );
}
