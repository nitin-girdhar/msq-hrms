'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { shifts as shiftsApi } from '../../../lib/api/client';
import type { ShiftView } from '../../../lib/attendance/types';

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
    setError(null);
  }, [open, editing]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const blockSubmit = submitting || !name.trim() || !startTime || !endTime;

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

        <label className="flex items-center gap-2 text-sm text-[#0F172A]">
          <input type="checkbox" checked={isNightShift} onChange={(e) => setIsNightShift(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
          <span>Night shift (crosses midnight)</span>
        </label>

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
