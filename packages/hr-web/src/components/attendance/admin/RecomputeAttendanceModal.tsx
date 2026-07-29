'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { shiftAssignments as shiftAssignmentsApi } from '../../../lib/api/client';
import type { ShiftAssignmentView } from '../../../lib/attendance/types';

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'recompute-attendance-form';

interface Props {
  open: boolean;
  /** The assignment whose employee and date range seed the form. */
  assignment: ShiftAssignmentView | undefined;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

/**
 * Re-applies day classification over a date range.
 *
 * Needed because attendance is resolved once and then frozen: the nightly job
 * skips any day that already has a row, so assigning or correcting a shift never
 * reclassifies the days the employee had already punched. Approved
 * regularizations are preserved by the server and are never overwritten.
 */
export default function RecomputeAttendanceModal({ open, assignment, onClose, onSaved }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [wholeOrg, setWholeOrg] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const today = new Date().toISOString().slice(0, 10);
    // Default to the window the assignment actually covers, clamped to today:
    // recomputing before it started would just re-resolve unrelated days.
    setFrom(assignment?.effective_from ?? today);
    setTo(assignment?.effective_to && assignment.effective_to < today ? assignment.effective_to : today);
    setWholeOrg(false);
    setError(null);
    setSubmitting(false);
  }, [open, assignment]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await shiftAssignmentsApi.recompute({
        ...(wholeOrg || !assignment ? {} : { user_id: assignment.user_id }),
        from,
        to,
      });
      const { days_processed, employees_processed } = res.data;
      onSaved(`Recomputed ${days_processed} day(s) across ${employees_processed} employee(s).`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recompute attendance.');
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
      <button type="submit" form={FORM_ID} disabled={submitting || !from || !to} aria-busy={submitting} className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60">
        {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
        {submitting ? 'Recomputing…' : 'Recompute'}
      </button>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title="Recompute attendance" locked={submitting} maxWidth="max-w-md" footer={footer}>
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <p className="text-xs text-[#64748B]">
          Re-applies shift rules to days that were already marked — use this after changing a shift
          or an assignment. Approved regularizations are never overwritten.
        </p>

        {assignment && (
          <div className="rounded-xl bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569]">
            <span className="font-semibold text-[#0F172A]">{assignment.user_full_name}</span> · {assignment.shift_name}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rc-from" className="text-xs font-semibold text-[#0F172A]">From *</label>
            <input id="rc-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rc-to" className="text-xs font-semibold text-[#0F172A]">To *</label>
            <input id="rc-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
        </div>

        {assignment && (
          <label className="flex items-start gap-2 text-xs text-[#0F172A]">
            <input
              type="checkbox"
              checked={wholeOrg}
              onChange={(e) => setWholeOrg(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1]"
            />
            <span>
              <span className="font-semibold">Every employee in this branch</span>
              <span className="block text-[11px] text-[#64748B]">
                Otherwise only {assignment.user_full_name} is recomputed.
              </span>
            </span>
          </label>
        )}

      </form>
    </Modal>
  );
}
