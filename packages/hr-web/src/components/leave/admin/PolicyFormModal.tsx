'use client';

import { useState } from 'react';
import { Modal } from '@platform/ui-kit';
import type { SessionUser } from '@crm/types';
import { leave as leaveApi, type CreatePolicyBody } from '../../../lib/api/client';
import { canManageTenantLeave } from '../../../lib/leave/format';

interface Props {
  open: boolean;
  actor: SessionUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}

// Seeded global leave types (hr.leave_types) — offered as suggestions; the field
// accepts any active type name (server validates against the lookup).
const LEAVE_TYPE_SUGGESTIONS = ['casual', 'sick', 'earned', 'maternity', 'paternity', 'bereavement', 'comp_off', 'loss_of_pay'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PolicyFormModal({ open, actor, onClose, onSaved }: Props) {
  const [leaveTypeName, setLeaveTypeName] = useState('');
  const [tenantWide, setTenantWide] = useState(false);
  const [accrualFrequency, setAccrualFrequency] = useState('none');
  const [accrualAmount, setAccrualAmount] = useState('0');
  const [maxBalance, setMaxBalance] = useState('');
  const [carryForward, setCarryForward] = useState(false);
  const [maxCarryForward, setMaxCarryForward] = useState('');
  const [maxConsecutive, setMaxConsecutive] = useState('');
  const [minNotice, setMinNotice] = useState('0');
  const [allowHalfDay, setAllowHalfDay] = useState(true);
  const [docAfter, setDocAfter] = useState('');
  const [approvalLevels, setApprovalLevels] = useState('1');
  const [applicableFrom, setApplicableFrom] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

  const reset = () => {
    setLeaveTypeName('');
    setTenantWide(false);
    setAccrualFrequency('none');
    setAccrualAmount('0');
    setMaxBalance('');
    setCarryForward(false);
    setMaxCarryForward('');
    setMaxConsecutive('');
    setMinNotice('0');
    setAllowHalfDay(true);
    setDocAfter('');
    setApprovalLevels('1');
    setApplicableFrom(todayIso());
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!leaveTypeName.trim()) { setError('Leave type is required.'); return; }
    if (Number(approvalLevels) < 1) { setError('Approval levels must be at least 1.'); return; }
    setSubmitting(true);
    try {
      const body: CreatePolicyBody = {
        leave_type_name: leaveTypeName.trim(),
        org_id: tenantWide ? null : actor.org_id,
        accrual_frequency: accrualFrequency,
        accrual_amount: Number(accrualAmount) || 0,
        max_balance: num(maxBalance),
        carry_forward: carryForward,
        max_carry_forward: num(maxCarryForward),
        max_consecutive_days: num(maxConsecutive),
        min_notice_days: Number(minNotice) || 0,
        allow_half_day: allowHalfDay,
        requires_document_after_days: num(docAfter),
        approval_levels: Number(approvalLevels),
        applicable_from: applicableFrom,
      };
      await leaveApi.createPolicy(body);
      reset();
      onSaved('Policy revision saved.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save policy.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20';
  const labelCls = 'text-xs font-semibold text-[#0F172A]';

  return (
    <Modal open={open} onClose={handleClose} title="Create / revise leave policy" locked={submitting} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[11px] text-[#64748B]">
          A revision is a <strong>new row effective from the chosen date</strong> — existing policy history is never modified.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pf-type" className={labelCls}>Leave type *</label>
            <input id="pf-type" list="pf-type-list" value={leaveTypeName} onChange={(e) => setLeaveTypeName(e.target.value)} disabled={submitting} className={inputCls} placeholder="e.g. casual" />
            <datalist id="pf-type-list">
              {LEAVE_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pf-from" className={labelCls}>Applicable from *</label>
            <input id="pf-from" type="date" value={applicableFrom} onChange={(e) => setApplicableFrom(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
        </div>

        {canManageTenantLeave(actor.rank) && (
          <label className="flex items-center gap-2 text-xs text-[#0F172A]">
            <input type="checkbox" checked={tenantWide} onChange={(e) => setTenantWide(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
            <span>Tenant-wide default (applies to all orgs unless a per-org policy overrides it)</span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pf-freq" className={labelCls}>Accrual frequency</label>
            <select id="pf-freq" value={accrualFrequency} onChange={(e) => setAccrualFrequency(e.target.value)} disabled={submitting} className={inputCls}>
              {['none', 'monthly', 'quarterly', 'yearly'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <NumField id="pf-amount" label="Accrual amount" value={accrualAmount} onChange={setAccrualAmount} disabled={submitting} />
          <NumField id="pf-maxbal" label="Max balance" value={maxBalance} onChange={setMaxBalance} disabled={submitting} placeholder="none" />
          <NumField id="pf-maxcarry" label="Max carry-forward" value={maxCarryForward} onChange={setMaxCarryForward} disabled={submitting} placeholder="none" />
          <NumField id="pf-maxconsec" label="Max consecutive days" value={maxConsecutive} onChange={setMaxConsecutive} disabled={submitting} placeholder="none" />
          <NumField id="pf-notice" label="Min notice (days)" value={minNotice} onChange={setMinNotice} disabled={submitting} />
          <NumField id="pf-docafter" label="Document after (days)" value={docAfter} onChange={setDocAfter} disabled={submitting} placeholder="none" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pf-levels" className={labelCls}>Approval levels</label>
            <input id="pf-levels" type="number" min={1} value={approvalLevels} onChange={(e) => setApprovalLevels(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
        </div>

        <p className="text-[11px] text-[#94A3B8]">
          Approval levels ≥ 1. The approver chain walks up the requester’s <strong>manager chain</strong> that many levels; short chains stop at the top-most manager, falling back to an org/HR admin.
        </p>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs text-[#0F172A]">
            <input type="checkbox" checked={carryForward} onChange={(e) => setCarryForward(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
            <span>Carry forward unused balance</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-[#0F172A]">
            <input type="checkbox" checked={allowHalfDay} onChange={(e) => setAllowHalfDay(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
            <span>Allow half-days</span>
          </label>
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={handleClose} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={submitting} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
            {submitting ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface NumFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}
function NumField({ id, label, value, onChange, disabled, placeholder }: NumFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[#0F172A]">{label}</label>
      <input
        id={id}
        type="number"
        step="0.5"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
      />
    </div>
  );
}
