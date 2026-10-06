'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveBalance, LeavePreview, HalfDay, LeaveRequestView } from '../../lib/leave/types';
import { formatDays } from '../../lib/leave/format';

interface Props {
  open: boolean;
  onClose: () => void;
  balances: LeaveBalance[];
  onApplied: () => void;
  /**
   * The pending request being amended, or null to apply for new leave.
   *
   * Editing reuses this form rather than a parallel one: the server re-validates
   * an amendment against exactly the rules it applies to a new request, so a
   * second form with its own subset of the fields could offer edits the server
   * would then refuse.
   */
  editing?: LeaveRequestView | null;
}

const HALF_OPTIONS: { value: HalfDay; label: string }[] = [
  { value: 'full', label: 'Full day' },
  { value: 'first_half', label: 'First half' },
  { value: 'second_half', label: 'Second half' },
];

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'apply-leave-form';

// Floor for the date inputs — leave is applied for today or later.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ApplyLeaveModal({ open, onClose, balances, onApplied, editing = null }: Props) {
  // Only types with a policy in force are bookable — a residual balance from a
  // withdrawn policy still shows on the cards but cannot be applied against.
  // Effective-dating lives on the server now (resolveEffectivePolicy), so this
  // component no longer replicates the org-beats-tenant / latest-applicable_from
  // rule against the full policy list.
  const typeOptions = useMemo(
    () =>
      balances
        .filter((b) => b.has_policy)
        .map((b) => ({ name: b.leave_type_name, label: b.leave_type_label })),
    [balances],
  );

  const [leaveTypeName, setLeaveTypeName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startHalf, setStartHalf] = useState<HalfDay>('full');
  const [endHalf, setEndHalf] = useState<HalfDay>('full');
  const [reason, setReason] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);

  const selected = balances.find((b) => b.leave_type_name === leaveTypeName);
  const allowHalf = selected?.allow_half_day ?? false;
  const balance = selected?.balance;

  // New leave is booked from today onwards. An existing request may already
  // start earlier (it was raised before today), and clamping the input to today
  // would make its own current value unreachable — so the floor drops to the
  // request's own start date while editing.
  const dateFloor =
    editing && editing.start_date < todayIso() ? editing.start_date : todayIso();

  const reset = () => {
    setLeaveTypeName('');
    setStartDate('');
    setEndDate('');
    setStartHalf('full');
    setEndHalf('full');
    setReason('');
    setDocumentUrl('');
    setPreview(null);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  // Load the request being edited into the form, and clear it again on the way
  // back to apply mode so a previous edit never leaks into a fresh request.
  useEffect(() => {
    if (!open) return;
    if (!editing) {
      reset();
      return;
    }
    setLeaveTypeName(editing.leave_type_name);
    setStartDate(editing.start_date);
    setEndDate(editing.end_date);
    setStartHalf(editing.start_half);
    setEndHalf(editing.end_half);
    setReason(editing.reason ?? '');
    setDocumentUrl(editing.document_url ?? '');
    setError(null);
    // Identity, not the object: the list is refetched after every mutation, so a
    // new object for the same request must not clobber in-progress typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // Live preview whenever type + a valid date range are set.
  useEffect(() => {
    if (!open) return;
    if (!leaveTypeName || !startDate || !endDate || startDate > endDate) {
      setPreview(null);
      return;
    }
    const seq = ++reqRef.current;
    setPreviewLoading(true);
    leaveApi
      .preview({
        leave_type_name: leaveTypeName,
        start_date: startDate,
        end_date: endDate,
        start_half: allowHalf ? startHalf : 'full',
        end_half: allowHalf ? endHalf : 'full',
      })
      .then((res) => {
        if (seq === reqRef.current) setPreview(res.data);
      })
      .catch(() => {
        if (seq === reqRef.current) setPreview(null);
      })
      .finally(() => {
        if (seq === reqRef.current) setPreviewLoading(false);
      });
  }, [open, leaveTypeName, startDate, endDate, startHalf, endHalf, allowHalf]);

  const showDocField =
    preview != null &&
    preview.requires_document_after_days != null &&
    preview.days_count > preview.requires_document_after_days;

  const blockSubmit =
    submitting ||
    previewLoading ||
    !leaveTypeName ||
    !startDate ||
    !endDate ||
    startDate > endDate ||
    preview == null ||
    preview.days_count <= 0 ||
    !preview.sufficient ||
    (showDocField && !documentUrl.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const body = {
      leave_type_name: leaveTypeName,
      start_date: startDate,
      end_date: endDate,
      start_half: allowHalf ? startHalf : 'full',
      end_half: allowHalf ? endHalf : 'full',
      reason: reason.trim() || undefined,
      document_url: documentUrl.trim() || undefined,
    };
    try {
      if (editing) {
        await leaveApi.update(editing.id, body);
      } else {
        await leaveApi.apply(body);
      }
      reset();
      onApplied();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : editing
            ? 'Failed to update the leave request.'
            : 'Failed to apply for leave.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low';

  // With no bookable leave type there is nothing to submit, so the footer drops
  // to a single dismiss action.
  const footer =
    typeOptions.length === 0 ? (
      <div className="flex justify-end">
        <button type="button" onClick={handleClose}
          className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low">
          Close
        </button>
      </div>
    ) : (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={handleClose} disabled={submitting}
          className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">
          Cancel
        </button>
        <button type="submit" form={FORM_ID} disabled={blockSubmit} aria-busy={submitting}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
          {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-primary/40 border-t-white" aria-hidden />}
          {submitting
            ? (editing ? 'Saving…' : 'Submitting…')
            : (editing ? 'Save changes' : 'Submit request')}
        </button>
      </div>
    );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={editing ? 'Edit leave request' : 'Apply for leave'}
      locked={submitting}
      maxWidth="max-w-lg"
      footer={footer}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
            {error}
          </div>
        )}

        {typeOptions.length === 0 ? (
          <p className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
            No leave types have an active policy for your org yet. Ask your HR admin to configure one.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="al-type" className="text-xs font-semibold text-on-surface">Leave type *</label>
              <select
                id="al-type"
                value={leaveTypeName}
                onChange={(e) => setLeaveTypeName(e.target.value)}
                disabled={submitting}
                className={inputCls}
              >
                <option value="">Select a type…</option>
                {typeOptions.map((t) => (
                  <option key={t.name} value={t.name}>{t.label}</option>
                ))}
              </select>
              {balance !== undefined && (
                <span className="text-[0.6875rem] text-on-surface-variant">Current balance: {formatDays(balance)}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="al-start" className="text-xs font-semibold text-on-surface">Start date *</label>
                <input
                  id="al-start"
                  type="date"
                  value={startDate}
                  min={dateFloor}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate && e.target.value > endDate) setEndDate(e.target.value);
                  }}
                  disabled={submitting}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="al-end" className="text-xs font-semibold text-on-surface">End date *</label>
                <input
                  id="al-end"
                  type="date"
                  value={endDate}
                  min={startDate || dateFloor}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={submitting}
                  className={inputCls}
                />
              </div>
            </div>

            {allowHalf && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="al-start-half" className="text-xs font-semibold text-on-surface">First day</label>
                  <select id="al-start-half" value={startHalf} onChange={(e) => setStartHalf(e.target.value as HalfDay)} disabled={submitting} className={inputCls}>
                    {HALF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="al-end-half" className="text-xs font-semibold text-on-surface">Last day</label>
                  <select id="al-end-half" value={endHalf} onChange={(e) => setEndHalf(e.target.value as HalfDay)} disabled={submitting} className={inputCls}>
                    {HALF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="al-reason" className="text-xs font-semibold text-on-surface">Reason</label>
                <SpeechInputButton onText={(t) => setReason((p) => appendDictation(p, t))} disabled={submitting} />
              </div>
              <textarea
                id="al-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                rows={2}
                className={inputCls}
              />
            </div>

            {showDocField && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="al-doc" className="text-xs font-semibold text-on-surface">Supporting document URL *</label>
                <input
                  id="al-doc"
                  type="url"
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                  disabled={submitting}
                  placeholder="https://…"
                  className={inputCls}
                />
                <span className="text-[0.6875rem] text-outline">
                  Required for this leave beyond {preview?.requires_document_after_days} day(s). No file upload yet — paste a link (e.g. a shared doc).
                </span>
              </div>
            )}

            {/* Live computed working-days display */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5">
              {previewLoading ? (
                <span className="text-xs text-outline">Calculating…</span>
              ) : preview ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-on-surface-variant">Working days</span>
                    <span className="font-semibold text-on-surface">{formatDays(preview.days_count)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-outline">Remaining after this leave</span>
                    <span className={preview.sufficient ? 'text-on-surface-variant' : 'text-status-overdue'}>
                      {preview.is_paid ? formatDays(preview.balance - preview.days_count) : 'n/a (unpaid)'}
                    </span>
                  </div>
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-[0.6875rem] text-on-status-due-container">⚠ {w}</p>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-outline">Select a type and dates to see the working-day count.</span>
              )}
            </div>

          </>
        )}
      </form>
    </Modal>
  );
}
