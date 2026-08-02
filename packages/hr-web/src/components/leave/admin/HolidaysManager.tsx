'use client';

import { useCallback, useEffect, useState } from 'react';
import { holidays as holidaysApi, holidayCalendars as calendarsApi } from '../../../lib/api/client';
import type { HolidayView, HolidayCalendarView } from '../../../lib/leave/types';

interface Props {
  onNotice: (msg: string) => void;
}

const CURRENT_YEAR = new Date().getUTCFullYear();
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

export default function HolidaysManager({ onNotice }: Props) {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [calendars, setCalendars] = useState<HolidayCalendarView[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [items, setItems] = useState<HolidayView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New-calendar fields
  const [newCalName, setNewCalName] = useState('');
  // New-holiday fields
  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const [hOptional, setHOptional] = useState(false);

  const loadCalendars = useCallback(() => {
    calendarsApi
      .list()
      .then((res) => setCalendars(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load calendars.'));
  }, []);

  const loadHolidays = useCallback(() => {
    holidaysApi
      .list({ year })
      .then((res) => setItems(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load holidays.'));
  }, [year]);

  useEffect(() => { loadCalendars(); }, [loadCalendars]);
  useEffect(() => { loadHolidays(); }, [loadHolidays]);

  // Only calendars belonging to the selected year are selectable — a 2025 calendar
  // must not stay selected while the admin is adding 2026 holidays.
  const yearCalendars = calendars.filter((c) => c.year === year);

  useEffect(() => {
    setCalendarId((prev) => (yearCalendars.some((c) => c.id === prev) ? prev : yearCalendars[0]?.id ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendars, year]);

  const createCalendar = async () => {
    if (!newCalName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const res = await calendarsApi.create({ name: newCalName.trim(), year });
      setNewCalName('');
      setCalendarId(res.data.id);
      onNotice('Holiday calendar created.');
      loadCalendars();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create calendar.');
    } finally {
      setBusy(false);
    }
  };

  const addHoliday = async () => {
    setError(null);
    if (!calendarId) { setError('Create or select a calendar first.'); return; }
    if (!hDate || !hName.trim()) { setError('Date and name are required.'); return; }
    if (!hDate.startsWith(`${year}-`)) { setError(`The date must fall in ${year}, the year of the selected calendar.`); return; }
    setBusy(true);
    try {
      await holidaysApi.create({ calendar_id: calendarId, holiday_date: hDate, name: hName.trim(), is_optional: hOptional });
      setHDate('');
      setHName('');
      setHOptional(false);
      onNotice('Holiday added.');
      loadHolidays();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add holiday.');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20';

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hm-year" className="text-xs font-semibold text-[#0F172A]">Year</label>
          <select id="hm-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputCls}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hm-cal" className="text-xs font-semibold text-[#0F172A]">Calendar</label>
          <select
            id="hm-cal"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            disabled={yearCalendars.length === 0}
            className={`${inputCls} disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]`}
          >
            {yearCalendars.length === 0 ? (
              <option value="">No calendar for {year}</option>
            ) : (
              <>
                <option value="">Select…</option>
                {yearCalendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </>
            )}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hm-newcal" className="text-xs font-semibold text-[#0F172A]">New calendar for {year}</label>
            <input id="hm-newcal" value={newCalName} onChange={(e) => setNewCalName(e.target.value)} placeholder="e.g. India Holidays" className={inputCls} />
          </div>
          <button type="button" onClick={createCalendar} disabled={busy || !newCalName.trim()} className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
            Add calendar
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Add holiday</p>
        {yearCalendars.length === 0 && (
          <p className="mb-3 text-xs text-[#64748B]">
            No holiday calendar exists for {year} yet. Name one above (e.g. “India Holidays”) and click <span className="font-semibold">Add calendar</span> before adding holidays.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hm-date" className="text-xs font-semibold text-[#0F172A]">Date</label>
            <input id="hm-date" type="date" value={hDate} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => setHDate(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hm-name" className="text-xs font-semibold text-[#0F172A]">Name</label>
            <input id="hm-name" value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Independence Day" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 pb-2.5 text-xs text-[#0F172A]">
            <input type="checkbox" checked={hOptional} onChange={(e) => setHOptional(e.target.checked)} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
            <span>Optional (restricted)</span>
          </label>
          <button type="button" onClick={addHoliday} disabled={busy || !calendarId} className="rounded-xl bg-[#0b6cbf] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
            Add holiday
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">No holidays for {year}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 text-[#475569]">{h.holiday_date}</td>
                  <td className="px-4 py-3 font-medium text-[#0F172A]">{h.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${h.is_optional ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      {h.is_optional ? 'Optional' : 'Public'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
