'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import { todayIso, shiftIso } from '../../lib/attendance/format';
import type { AttendanceRules, AttendanceStatusName, RegularizationView } from '../../lib/attendance/types';

interface Props {
  open: boolean;
  date: string | null;
  /** Present = edit an existing pending request instead of filing a new one. */
  item?: RegularizationView | null;
  /**
   * The effective attendance rules, used to bound the date picker to the window
   * the server will accept. Optional because the rules load asynchronously: when
   * absent the picker is unbounded and the server's 400 carries the message,
   * which is a worse experience but never a wrong one.
   */
  rules?: AttendanceRules | null;
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

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'regularization-form';

function toIsoWithOffset(localDatetime: string): string | undefined {
  if (!localDatetime) return undefined;
  const d = new Date(localDatetime);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// ISO → the `YYYY-MM-DDTHH:mm` a datetime-local input accepts, in browser-local
// time (the same conversion toIsoWithOffset reverses on submit).
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RegularizationFormModal({ open, date, item, rules, onClose, onSubmitted }: Props) {
  const [workDate, setWorkDate] = useState('');
  const [mode, setMode] = useState<'status' | 'times'>('status');
  const [statusName, setStatusName] = useState<AttendanceStatusName | ''>('');
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = !!item;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (item) {
      setWorkDate(item.work_date);
      setMode(item.requested_status_name ? 'status' : 'times');
      setStatusName(item.requested_status_name ?? '');
      setInTime(toLocalInput(item.requested_in));
      setOutTime(toLocalInput(item.requested_out));
      setReason(item.reason);
      return;
    }
    setWorkDate(date ?? '');
    setMode('status');
    setStatusName('');
    setInTime('');
    setOutTime('');
    setReason('');
  }, [open, date, item]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  // The window the server enforces (attendance_rules.regularization_max_backdate_days,
  // counted in the ORG timezone). Mirrored here so the picker refuses exactly
  // what the API refuses rather than letting someone fill in a whole form for a
  // date that was never going to be accepted.
  const latestDate = rules ? todayIso(rules.timezone) : null;
  const earliestDate =
    rules && latestDate ? shiftIso(latestDate, -rules.regularization_max_backdate_days) : null;
  // `min`/`max` stop the picker's own UI, but a typed date can still land
  // outside them, so the value is checked too.
  const dateOutOfWindow =
    !editing && !!workDate && !!latestDate && !!earliestDate &&
    (workDate > latestDate || workDate < earliestDate);

  const blockSubmit =
    submitting ||
    !workDate ||
    dateOutOfWindow ||
    !reason.trim() ||
    (mode === 'status' ? !statusName : !inTime && !outTime);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (item) {
        // Nulls, not undefined: switching status→times must clear the field the
        // other mode set, and PATCH treats an absent key as "leave unchanged".
        await attendanceApi.regularizations.update(item.id, {
          requested_status_name: mode === 'status' ? statusName || null : null,
          requested_in: mode === 'times' ? toIsoWithOffset(inTime) ?? null : null,
          requested_out: mode === 'times' ? toIsoWithOffset(outTime) ?? null : null,
          reason: reason.trim(),
        });
      } else {
        await attendanceApi.regularizations.create({
          work_date: workDate,
          requested_status_name: mode === 'status' ? statusName || undefined : undefined,
          requested_in: mode === 'times' ? toIsoWithOffset(inTime) : undefined,
          requested_out: mode === 'times' ? toIsoWithOffset(outTime) : undefined,
          reason: reason.trim(),
        });
      }
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

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={handleClose} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
        Cancel
      </button>
      <button type="submit" form={FORM_ID} disabled={blockSubmit} aria-busy={submitting} className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60">
        {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
        {submitting ? 'Saving…' : editing ? 'Save changes' : 'Submit request'}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={editing ? 'Edit regularization' : 'Request regularization'}
      locked={submitting}
      maxWidth="max-w-md"
      footer={footer}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rg-date" className="text-xs font-semibold text-[#0F172A]">Date *</label>
          {/* Locked while editing: only one open request may exist per date, so
              moving one is a cancel-and-refile, not an edit. */}
          <input
            id="rg-date"
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            disabled={submitting || editing}
            {...(!editing && earliestDate ? { min: earliestDate } : {})}
            {...(!editing && latestDate ? { max: latestDate } : {})}
            className={inputCls}
          />
          {editing ? (
            <p className="text-[11px] text-[#94A3B8]">
              To request a different date, cancel this request and file a new one.
            </p>
          ) : dateOutOfWindow ? (
            <p role="alert" className="text-[11px] font-medium text-red-600">
              Pick a date between {earliestDate} and {latestDate}.
            </p>
          ) : earliestDate && latestDate ? (
            <p className="text-[11px] text-[#94A3B8]">
              {earliestDate === latestDate
                ? `Only today (${latestDate}) can be regularized.`
                : `Dates from ${earliestDate} to ${latestDate} can be regularized.`}
            </p>
          ) : null}
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

      </form>
    </Modal>
  );
}
