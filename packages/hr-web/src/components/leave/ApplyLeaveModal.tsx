'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { leave as leaveApi } from '../../lib/api/client';
import type { LeaveBalance, LeavePolicyView, LeavePreview, HalfDay } from '../../lib/leave/types';
import { formatDays } from '../../lib/leave/format';

interface Props {
  open: boolean;
  onClose: () => void;
  policies: LeavePolicyView[];
  balances: LeaveBalance[];
  onApplied: () => void;
}

const HALF_OPTIONS: { value: HalfDay; label: string }[] = [
  { value: 'full', label: 'Full day' },
  { value: 'first_half', label: 'First half' },
  { value: 'second_half', label: 'Second half' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Effective policy per leave type as of today: org-specific wins over tenant-wide,
// latest applicable_from ≤ today. The policies list is already ordered
// (org_id NOT NULL first, then applicable_from DESC), so the first active row per
// type with applicable_from ≤ today is effective.
function effectivePoliciesByType(policies: LeavePolicyView[]): Map<string, LeavePolicyView> {
  const today = todayIso();
  const map = new Map<string, LeavePolicyView>();
  for (const p of policies) {
    if (!p.is_active) continue;
    if (p.applicable_from > today) continue;
    if (!map.has(p.leave_type_name)) map.set(p.leave_type_name, p);
  }
  return map;
}

export default function ApplyLeaveModal({ open, onClose, policies, balances, onApplied }: Props) {
  const effectiveByType = useMemo(() => effectivePoliciesByType(policies), [policies]);
  const typeOptions = useMemo(
    () =>
      Array.from(effectiveByType.values()).map((p) => ({
        name: p.leave_type_name,
        label: p.leave_type_label,
      })),
    [effectiveByType],
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

  const effectivePolicy = leaveTypeName ? effectiveByType.get(leaveTypeName) : undefined;
  const allowHalf = effectivePolicy?.allow_half_day ?? false;
  const balance = balances.find((b) => b.leave_type_name === leaveTypeName)?.balance;

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
    try {
      await leaveApi.apply({
        leave_type_name: leaveTypeName,
        start_date: startDate,
        end_date: endDate,
        start_half: allowHalf ? startHalf : 'full',
        end_half: allowHalf ? endHalf : 'full',
        reason: reason.trim() || undefined,
        document_url: documentUrl.trim() || undefined,
      });
      reset();
      onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply for leave.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

  return (
    <Modal open={open} onClose={handleClose} title="Apply for leave" locked={submitting} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {typeOptions.length === 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No leave types have an active policy for your org yet. Ask your HR admin to configure one.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="al-type" className="text-xs font-semibold text-[#0F172A]">Leave type *</label>
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
                <span className="text-[11px] text-[#64748B]">Current balance: {formatDays(balance)}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="al-start" className="text-xs font-semibold text-[#0F172A]">Start date *</label>
                <input
                  id="al-start"
                  type="date"
                  value={startDate}
                  min={todayIso()}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate && e.target.value > endDate) setEndDate(e.target.value);
                  }}
                  disabled={submitting}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="al-end" className="text-xs font-semibold text-[#0F172A]">End date *</label>
                <input
                  id="al-end"
                  type="date"
                  value={endDate}
                  min={startDate || todayIso()}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={submitting}
                  className={inputCls}
                />
              </div>
            </div>

            {allowHalf && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="al-start-half" className="text-xs font-semibold text-[#0F172A]">First day</label>
                  <select id="al-start-half" value={startHalf} onChange={(e) => setStartHalf(e.target.value as HalfDay)} disabled={submitting} className={inputCls}>
                    {HALF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="al-end-half" className="text-xs font-semibold text-[#0F172A]">Last day</label>
                  <select id="al-end-half" value={endHalf} onChange={(e) => setEndHalf(e.target.value as HalfDay)} disabled={submitting} className={inputCls}>
                    {HALF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="al-reason" className="text-xs font-semibold text-[#0F172A]">Reason</label>
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
                <label htmlFor="al-doc" className="text-xs font-semibold text-[#0F172A]">Supporting document URL *</label>
                <input
                  id="al-doc"
                  type="url"
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                  disabled={submitting}
                  placeholder="https://…"
                  className={inputCls}
                />
                <span className="text-[11px] text-[#94A3B8]">
                  Required for this leave beyond {preview?.requires_document_after_days} day(s). No file upload yet — paste a link (e.g. a shared doc).
                </span>
              </div>
            )}

            {/* Live computed working-days display */}
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
              {previewLoading ? (
                <span className="text-xs text-[#94A3B8]">Calculating…</span>
              ) : preview ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#64748B]">Working days</span>
                    <span className="font-semibold text-[#0F172A]">{formatDays(preview.days_count)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#94A3B8]">Remaining after this leave</span>
                    <span className={preview.sufficient ? 'text-[#475569]' : 'text-red-600'}>
                      {preview.is_paid ? formatDays(preview.balance - preview.days_count) : 'n/a (unpaid)'}
                    </span>
                  </div>
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] text-amber-700">⚠ {w}</p>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-[#94A3B8]">Select a type and dates to see the working-day count.</span>
              )}
            </div>

            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={handleClose} disabled={submitting}
                className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
                Cancel
              </button>
              <button type="submit" disabled={blockSubmit} aria-busy={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60">
                {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
