'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { shifts as shiftsApi } from '../../../lib/api/client';
import type { ShiftView, ShiftSegmentView } from '../../../lib/attendance/types';

const MINUTES_PER_DAY = 1440;

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'shift-form';

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
  // '' = follow the attendance policy; a number (incl. 0 = no rule) is this shift's own minimum rest.
  const [minRest, setMinRest] = useState('');
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
    setMinRest(editing?.min_rest_hours != null ? String(editing.min_rest_hours) : '');
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

  const minRestInvalid = minRest.trim() !== '' && !(Number.isInteger(Number(minRest)) && Number(minRest) >= 0 && Number(minRest) <= 24);
  const blockSubmit =
    minRestInvalid || submitting || !name.trim() || !startTime || !endTime || segmentError !== null || thresholdOrderInvalid;

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
        // null clears the shift's own value so it follows the policy again.
        min_rest_hours: minRest.trim() === '' ? null : Number(minRest),
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
    'rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low';

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={handleClose} disabled={submitting} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">
        Cancel
      </button>
      <button type="submit" form={FORM_ID} disabled={blockSubmit} aria-busy={submitting} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
        {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-primary/40 border-t-white" aria-hidden />}
        {submitting ? 'Saving…' : 'Save'}
      </button>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title={editing ? 'Edit shift' : 'Create shift'} locked={submitting} maxWidth="max-w-md" footer={footer}>
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sf-name" className="text-xs font-semibold text-on-surface">Name *</label>
          <input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-start" className="text-xs font-semibold text-on-surface">Start time *</label>
            <input id="sf-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-end" className="text-xs font-semibold text-on-surface">End time *</label>
            <input id="sf-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-grace" className="text-xs font-semibold text-on-surface">Grace (min)</label>
            <input id="sf-grace" type="number" min={0} value={graceMinutes} onChange={(e) => setGraceMinutes(Number(e.target.value))} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-half" className="text-xs font-semibold text-on-surface">Min half-day (min)</label>
            <input id="sf-half" type="number" min={0} value={minHalfDay} onChange={(e) => setMinHalfDay(Number(e.target.value))} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sf-full" className="text-xs font-semibold text-on-surface">Min full-day (min)</label>
            <input id="sf-full" type="number" min={0} value={minFullDay} onChange={(e) => setMinFullDay(Number(e.target.value))} disabled={submitting} className={inputCls} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sf-rest" className="text-xs font-semibold text-on-surface">Minimum rest before this shift (hours)</label>
          <input id="sf-rest" type="number" min={0} max={24} step={1} value={minRest} onChange={(e) => setMinRest(e.target.value)} placeholder="Follow the attendance policy" disabled={submitting} className={inputCls} />
          <p className="text-xs text-on-surface-variant">Leave empty to use the attendance policy. 0 means no rest rule for this shift.</p>
          {minRestInvalid && <p role="alert" className="text-xs font-medium text-status-overdue">Enter a whole number from 0 to 24, or leave it empty.</p>}
        </div>

        {thresholdOrderInvalid && (
          <p role="alert" className="text-xs font-medium text-status-overdue">
            The half-day minimum must not exceed the full-day minimum.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input type="checkbox" checked={isNightShift} onChange={(e) => setIsNightShift(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-outline-variant text-primary" />
          <span>Night shift (crosses midnight)</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input type="checkbox" checked={isSplit} onChange={(e) => toggleSplit(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-outline-variant text-primary" />
          <span>Split shift (works several slots in a day)</span>
        </label>

        {isSplit && (
          <div className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-3">
            <p className="text-xs text-on-surface-variant">
              Each slot the employee is expected to work. They check in and out once per
              slot, and the day&apos;s total is the sum of those sessions — the gap between
              slots is not paid time. Every slot must sit inside {startTime}–{endTime}.
            </p>

            {segments.map((seg, i) => (
              <div key={seg.seq} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-xs font-semibold text-outline">{seg.seq}</span>
                <input
                  type="time" aria-label={`Segment ${seg.seq} start`}
                  value={seg.start_time}
                  onChange={(e) => setSegmentField(i, 'start_time', e.target.value)}
                  disabled={submitting} className={`${inputCls} flex-1`}
                />
                <span className="text-xs text-outline">to</span>
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
                  className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}

            <div>
              <button
                type="button" onClick={addSegment} disabled={submitting || segments.length >= 12}
                className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add segment
              </button>
            </div>

            {segmentError && (
              <p role="alert" className="text-xs font-medium text-status-overdue">{segmentError}</p>
            )}
          </div>
        )}

      </form>
    </Modal>
  );
}
