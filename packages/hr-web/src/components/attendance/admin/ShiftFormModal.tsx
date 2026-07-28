'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { shifts as shiftsApi } from '../../../lib/api/client';
import type { ShiftView, ShiftSegmentView } from '../../../lib/attendance/types';

const MINUTES_PER_DAY = 1440;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Minutes elapsed from the shift's start, wrapping across midnight. */
function fromShiftStart(minutes: number, shiftStartMin: number): number {
  return ((minutes - shiftStartMin) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Same rules the server enforces (validateSegments in hr-service and the Zod
 * superRefine in @hr/validation), duplicated here so an overlap is caught while
 * the admin is still looking at the form rather than after a round trip.
 */
function segmentProblem(segments: ShiftSegmentView[], start: string, end: string): string | null {
  if (segments.length < 2) return 'A split shift needs at least 2 segments.';
  if (!start || !end) return null;

  const shiftStartMin = toMinutes(start);
  let windowEnd = fromShiftStart(toMinutes(end), shiftStartMin);
  if (windowEnd === 0) windowEnd = MINUTES_PER_DAY;

  const ranges: Array<{ seq: number; start: number; end: number }> = [];
  for (const seg of segments) {
    if (!seg.start_time || !seg.end_time) return 'Every segment needs a start and end time.';
    const s = fromShiftStart(toMinutes(seg.start_time), shiftStartMin);
    let e = fromShiftStart(toMinutes(seg.end_time), shiftStartMin);
    if (e <= s) e += MINUTES_PER_DAY;
    if (e > windowEnd) {
      return `Segment ${seg.seq} (${seg.start_time}–${seg.end_time}) falls outside the shift window ${start}–${end}.`;
    }
    ranges.push({ seq: seg.seq, start: s, end: e });
  }

  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]!.start < ranges[i - 1]!.end) {
      return `Segments ${ranges[i - 1]!.seq} and ${ranges[i]!.seq} overlap.`;
    }
  }
  return null;
}

interface Props {
  open: boolean;
  editing: ShiftView | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export default function ShiftFormModal({ open, editing, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [minHalfDay, setMinHalfDay] = useState(240);
  const [minFullDay, setMinFullDay] = useState(480);
  const [isNightShift, setIsNightShift] = useState(false);
  const [isSplit, setIsSplit] = useState(false);
  const [segments, setSegments] = useState<ShiftSegmentView[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setStartTime(editing?.start_time?.slice(0, 5) ?? '09:00');
    setEndTime(editing?.end_time?.slice(0, 5) ?? '18:00');
    setGraceMinutes(editing?.grace_minutes ?? 10);
    setMinHalfDay(editing?.min_half_day_minutes ?? 240);
    setMinFullDay(editing?.min_full_day_minutes ?? 480);
    setIsNightShift(editing?.is_night_shift ?? false);
    setIsSplit(editing?.is_split ?? false);
    setSegments(
      (editing?.segments ?? []).map((s) => ({
        seq: s.seq,
        start_time: s.start_time.slice(0, 5),
        end_time: s.end_time.slice(0, 5),
      })),
    );
    setError(null);
  }, [open, editing]);

  // seq is positional, so it is always renumbered from the array rather than
  // tracked per row — the server requires 1..n without gaps.
  const renumber = (list: ShiftSegmentView[]) => list.map((s, i) => ({ ...s, seq: i + 1 }));

  const setSegmentField = (index: number, field: 'start_time' | 'end_time', value: string) =>
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));

  const addSegment = () =>
    setSegments((prev) => renumber([...prev, { seq: prev.length + 1, start_time: '', end_time: '' }]));

  const removeSegment = (index: number) =>
    setSegments((prev) => renumber(prev.filter((_, i) => i !== index)));

  // Turning split on with nothing configured: seed two rows so the shape of what
  // is being asked for is visible immediately.
  const toggleSplit = (v: boolean) => {
    setIsSplit(v);
    if (v && segments.length === 0) {
      setSegments([
        { seq: 1, start_time: startTime, end_time: '' },
        { seq: 2, start_time: '', end_time: endTime },
      ]);
    }
  };

  const segmentError = isSplit ? segmentProblem(segments, startTime, endTime) : null;
  const thresholdOrderInvalid = minHalfDay > minFullDay;

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const blockSubmit =
    submitting || !name.trim() || !startTime || !endTime || segmentError !== null || thresholdOrderInvalid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        start_time: startTime,
        end_time: endTime,
        grace_minutes: graceMinutes,
        min_half_day_minutes: minHalfDay,
        min_full_day_minutes: minFullDay,
        is_night_shift: isNightShift,
        is_split: isSplit,
        // Always sent so turning split off clears the stored set server-side.
        segments: isSplit ? segments : [],
      };
      if (editing) {
        await shiftsApi.update(editing.id, body);
      } else {
        await shiftsApi.create(body);
      }
      onSaved(editing ? 'Shift updated.' : 'Shift created.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the shift.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

  return (
    <Modal open={open} onClose={handleClose} title={editing ? 'Edit shift' : 'Create shift'} locked={submitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sf-name" className="text-xs font-semibold text-[#0F172A]">Name *</label>
          <input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-start" className="text-xs font-semibold text-[#0F172A]">Start time *</label>
            <input id="sf-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-end" className="text-xs font-semibold text-[#0F172A]">End time *</label>
            <input id="sf-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-grace" className="text-xs font-semibold text-[#0F172A]">Grace (min)</label>
            <input id="sf-grace" type="number" min={0} value={graceMinutes} onChange={(e) => setGraceMinutes(Number(e.target.value))} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-half" className="text-xs font-semibold text-[#0F172A]">Min half-day (min)</label>
            <input id="sf-half" type="number" min={0} value={minHalfDay} onChange={(e) => setMinHalfDay(Number(e.target.value))} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-full" className="text-xs font-semibold text-[#0F172A]">Min full-day (min)</label>
            <input id="sf-full" type="number" min={0} value={minFullDay} onChange={(e) => setMinFullDay(Number(e.target.value))} disabled={submitting} className={inputCls} />
          </div>
        </div>

        {thresholdOrderInvalid && (
          <p role="alert" className="text-xs font-medium text-red-600">
            The half-day minimum must not exceed the full-day minimum.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-[#0F172A]">
          <input type="checkbox" checked={isNightShift} onChange={(e) => setIsNightShift(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
          <span>Night shift (crosses midnight)</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-[#0F172A]">
          <input type="checkbox" checked={isSplit} onChange={(e) => toggleSplit(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
          <span>Split shift (works several slots in a day)</span>
        </label>

        {isSplit && (
          <div className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-3">
            <p className="text-xs text-[#64748B]">
              Each slot the employee is expected to work. They check in and out once per
              slot, and the day&apos;s total is the sum of those sessions — the gap between
              slots is not paid time. Every slot must sit inside {startTime}–{endTime}.
            </p>

            {segments.map((seg, i) => (
              <div key={seg.seq} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-xs font-semibold text-[#94A3B8]">{seg.seq}</span>
                <input
                  type="time" aria-label={`Segment ${seg.seq} start`}
                  value={seg.start_time}
                  onChange={(e) => setSegmentField(i, 'start_time', e.target.value)}
                  disabled={submitting} className={`${inputCls} flex-1`}
                />
                <span className="text-xs text-[#94A3B8]">to</span>
                <input
                  type="time" aria-label={`Segment ${seg.seq} end`}
                  value={seg.end_time}
                  onChange={(e) => setSegmentField(i, 'end_time', e.target.value)}
                  disabled={submitting} className={`${inputCls} flex-1`}
                />
                <button
                  type="button" onClick={() => removeSegment(i)}
                  disabled={submitting || segments.length <= 2}
                  aria-label={`Remove segment ${seg.seq}`}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}

            <div>
              <button
                type="button" onClick={addSegment} disabled={submitting || segments.length >= 12}
                className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#0b6cbf] hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add segment
              </button>
            </div>

            {segmentError && (
              <p role="alert" className="text-xs font-medium text-red-600">{segmentError}</p>
            )}
          </div>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={handleClose} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={blockSubmit} aria-busy={submitting} className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60">
            {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
