'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { shiftAssignments as shiftAssignmentsApi, shifts as shiftsApi, hrEmployees } from '../../../lib/api/client';
import type { ShiftView } from '../../../lib/attendance/types';
import type { EmployeeProfileView } from '../../../lib/leave/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export default function ShiftAssignmentFormModal({ open, onClose, onSaved }: Props) {
  const [employees, setEmployees] = useState<EmployeeProfileView[]>([]);
  const [shiftOptions, setShiftOptions] = useState<ShiftView[]>([]);
  const [userId, setUserId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUserId('');
    setShiftId('');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setEffectiveTo('');
    setError(null);
    Promise.all([hrEmployees.list(), shiftsApi.list()])
      .then(([e, s]) => { setEmployees(e.data); setShiftOptions(s.data.filter((x) => x.is_active)); })
      .catch(() => { /* lookups optional */ });
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const blockSubmit = submitting || !userId || !shiftId || !effectiveFrom;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await shiftAssignmentsApi.create({
        user_id: userId,
        shift_id: shiftId,
        effective_from: effectiveFrom,
        effective_to: effectiveTo || null,
      });
      onSaved('Shift assignment created.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the shift assignment.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

  return (
    <Modal open={open} onClose={handleClose} title="Assign shift" locked={submitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sa-user" className="text-xs font-semibold text-[#0F172A]">Employee *</label>
          <select id="sa-user" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={submitting} className={inputCls}>
            <option value="">Select…</option>
            {employees.map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name} ({e.email})</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sa-shift" className="text-xs font-semibold text-[#0F172A]">Shift *</label>
          <select id="sa-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} disabled={submitting} className={inputCls}>
            <option value="">Select…</option>
            {shiftOptions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sa-from" className="text-xs font-semibold text-[#0F172A]">Effective from *</label>
            <input id="sa-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sa-to" className="text-xs font-semibold text-[#0F172A]">Effective to</label>
            <input id="sa-to" type="date" value={effectiveTo} min={effectiveFrom} onChange={(e) => setEffectiveTo(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={handleClose} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={blockSubmit} aria-busy={submitting} className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60">
            {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {submitting ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
