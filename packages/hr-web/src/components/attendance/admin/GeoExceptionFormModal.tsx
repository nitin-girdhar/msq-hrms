'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { geoExceptions as geoExceptionsApi, hrEmployees } from '../../../lib/api/client';
import type { GeoExceptionType, GeoExceptionView } from '../../../lib/attendance/types';
import type { EmployeeProfileView } from '../../../lib/leave/types';

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'geo-exception-form';

const TYPE_COPY: Record<GeoExceptionType, { label: string; hint: string }> = {
  remote_role: {
    label: 'Remote / field role',
    hint: 'For someone whose role rotates across locations. Usually left open-ended — leave the end date empty until the role changes.',
  },
  wfh: {
    label: 'Work from home',
    hint: 'For an approved stretch at home. Every punch in the window is recorded as work from home automatically — the employee ticks nothing.',
  },
};

interface Props {
  open: boolean;
  /** Present → edit that exception; absent → create a new one. */
  exception?: GeoExceptionView | undefined;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export default function GeoExceptionFormModal({ open, exception, onClose, onSaved }: Props) {
  const isEdit = !!exception;
  const [employees, setEmployees] = useState<EmployeeProfileView[]>([]);
  const [userId, setUserId] = useState('');
  const [type, setType] = useState<GeoExceptionType>('remote_role');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [reason, setReason] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUserId(exception?.user_id ?? '');
    setType(exception?.exception_type ?? 'remote_role');
    setEffectiveFrom(exception?.effective_from ?? new Date().toISOString().slice(0, 10));
    setEffectiveTo(exception?.effective_to ?? '');
    setReason(exception?.reason ?? '');
    setIsActive(exception?.is_active ?? true);
    setError(null);
    setLoadingLookups(true);
    hrEmployees
      .list({ limit: 100 })
      .then((res) => setEmployees(res.data))
      .catch(() => setError('Could not load employees. Close and retry.'))
      .finally(() => setLoadingLookups(false));
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const blockSubmit = submitting || !userId || !effectiveFrom || reason.trim().length < 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (exception) {
        // Neither the employee nor the kind may be changed here: both would
        // rewrite the stated reason for punches already made under this row.
        await geoExceptionsApi.update(exception.id, {
          effective_from: effectiveFrom,
          effective_to: effectiveTo || null,
          reason: reason.trim(),
          is_active: isActive,
        });
        onSaved('Geofence exception updated.');
      } else {
        await geoExceptionsApi.create({
          user_id: userId,
          exception_type: type,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || null,
          reason: reason.trim(),
        });
        onSaved(
          type === 'wfh'
            ? 'Work-from-home exception added.'
            : 'Remote check-in exception added.',
        );
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${exception ? 'update' : 'add'} the exception.`,
      );
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
        {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add exception'}
      </button>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title={isEdit ? 'Edit geofence exception' : 'Add geofence exception'} locked={submitting} maxWidth="max-w-md" footer={footer}>
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ge-user" className="text-xs font-semibold text-[#0F172A]">Employee *</label>
          <select id="ge-user" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={submitting || loadingLookups || isEdit} className={inputCls}>
            <option value="">{loadingLookups ? 'Loading…' : 'Select…'}</option>
            {/* In edit mode the roster may not contain this user (inactive
                profile), so fall back to the name the row already carries. */}
            {isEdit && !employees.some((e) => e.user_id === userId) && (
              <option value={userId}>{exception!.user_full_name}</option>
            )}
            {employees.map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name} ({e.email})</option>)}
          </select>
          {isEdit && (
            <p className="text-[11px] text-[#64748B]">
              The employee cannot be changed. End this exception and add a new one instead.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ge-type" className="text-xs font-semibold text-[#0F172A]">Kind *</label>
          <select id="ge-type" value={type} onChange={(e) => setType(e.target.value as GeoExceptionType)} disabled={submitting || isEdit} className={inputCls}>
            <option value="remote_role">{TYPE_COPY.remote_role.label}</option>
            <option value="wfh">{TYPE_COPY.wfh.label}</option>
          </select>
          <p className="text-[11px] text-[#64748B]">
            {isEdit
              ? 'The kind cannot be changed — it is the recorded reason for punches already made under this exception.'
              : TYPE_COPY[type].hint}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ge-from" className="text-xs font-semibold text-[#0F172A]">Effective from *</label>
            <input id="ge-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ge-to" className="text-xs font-semibold text-[#0F172A]">Effective to</label>
            <input id="ge-to" type="date" value={effectiveTo} min={effectiveFrom} onChange={(e) => setEffectiveTo(e.target.value)} disabled={submitting} className={inputCls} />
            <p className="text-[11px] text-[#64748B]">Leave empty for open-ended.</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ge-reason" className="text-xs font-semibold text-[#0F172A]">Reason *</label>
          <textarea
            id="ge-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            rows={3}
            maxLength={500}
            placeholder="e.g. Rotating field role — covers the north territory"
            className={inputCls}
          />
          {/* Required, not optional: this is the record that has to explain,
              months later, why this person's attendance was not location-checked. */}
          <p className="text-[11px] text-[#64748B]">
            Shown in the attendance audit trail. Say why this person is not held to the office radius.
          </p>
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-xs font-semibold text-[#0F172A]">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-[#CBD5E1]"
            />
            Active
          </label>
        )}
      </form>
    </Modal>
  );
}
