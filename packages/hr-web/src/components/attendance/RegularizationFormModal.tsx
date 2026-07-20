'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { AttendanceStatusName } from '../../lib/attendance/types';

interface Props {
  open: boolean;
  date: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const STATUS_OPTIONS: { value: AttendanceStatusName; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'half_day', label: 'Half day' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'weekly_off', label: 'Weekly off' },
  { value: 'wfh', label: 'WFH' },
];

function toIsoWithOffset(localDatetime: string): string | undefined {
  if (!localDatetime) return undefined;
  const d = new Date(localDatetime);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export default function RegularizationFormModal({ open, date, onClose, onSubmitted }: Props) {
  const [workDate, setWorkDate] = useState('');
  const [mode, setMode] = useState<'status' | 'times'>('status');
  const [statusName, setStatusName] = useState<AttendanceStatusName | ''>('');
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWorkDate(date ?? '');
    setMode('status');
    setStatusName('');
    setInTime('');
    setOutTime('');
    setReason('');
    setError(null);
  }, [open, date]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const blockSubmit =
    submitting ||
    !workDate ||
    !reason.trim() ||
    (mode === 'status' ? !statusName : !inTime && !outTime);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await attendanceApi.regularizations.create({
        work_date: workDate,
        requested_status_name: mode === 'status' ? statusName || undefined : undefined,
        requested_in: mode === 'times' ? toIsoWithOffset(inTime) : undefined,
        requested_out: mode === 'times' ? toIsoWithOffset(outTime) : undefined,
        reason: reason.trim(),
      });
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit regularization.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

  return (
    <Modal open={open} onClose={handleClose} title="Request regularization" locked={submitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rg-date" className="text-xs font-semibold text-[#0F172A]">Date *</label>
          <input id="rg-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} disabled={submitting} className={inputCls} />
        </div>

        <div className="flex gap-1 rounded-xl border border-[#E2E8F0] bg-white p-1">
          {(['status', 'times'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={mode === m ? 'flex-1 rounded-lg bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#0b6cbf]' : 'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#F8FAFC]'}
            >
              {m === 'status' ? 'Requested status' : 'Requested times'}
            </button>
          ))}
        </div>

        {mode === 'status' ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rg-status" className="text-xs font-semibold text-[#0F172A]">Requested status *</label>
            <select id="rg-status" value={statusName} onChange={(e) => setStatusName(e.target.value as AttendanceStatusName)} disabled={submitting} className={inputCls}>
              <option value="">Select…</option>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rg-in" className="text-xs font-semibold text-[#0F172A]">Check-in time</label>
              <input id="rg-in" type="datetime-local" value={inTime} onChange={(e) => setInTime(e.target.value)} disabled={submitting} className={inputCls} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rg-out" className="text-xs font-semibold text-[#0F172A]">Check-out time</label>
              <input id="rg-out" type="datetime-local" value={outTime} onChange={(e) => setOutTime(e.target.value)} disabled={submitting} className={inputCls} />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rg-reason" className="text-xs font-semibold text-[#0F172A]">Reason *</label>
          <textarea id="rg-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={submitting} rows={3} className={inputCls} />
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={handleClose} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={blockSubmit} aria-busy={submitting} className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60">
            {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
