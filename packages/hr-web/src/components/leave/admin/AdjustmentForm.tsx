'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '@platform/ui-kit';
import { leave as leaveApi } from '../../../lib/api/client';

interface Props {
  onNotice: (msg: string) => void;
}

interface UserOption {
  id: string;
  label: string;
}

const LEAVE_TYPE_SUGGESTIONS = ['casual', 'sick', 'earned', 'maternity', 'paternity', 'bereavement', 'comp_off', 'loss_of_pay'];

export default function AdjustmentForm({ onNotice }: Props) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [userId, setUserId] = useState('');
  const [leaveTypeName, setLeaveTypeName] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usersApi
      .list()
      .then((res) => {
        const list = ((res.data as Array<Record<string, unknown>>) ?? []).map((u) => ({
          id: u['id'] as string,
          label: (u['full_name'] as string) ?? (u['email'] as string) ?? '',
        }));
        setUsers(list);
      })
      .catch(() => setUsers([]));
  }, []);

  const validate = (): string | null => {
    if (!userId) return 'Select a user.';
    if (!leaveTypeName.trim()) return 'Select a leave type.';
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n === 0) return 'Amount must be a non-zero number (use a minus sign to deduct).';
    if (!note.trim()) return 'A note is required for every manual adjustment.';
    return null;
  };

  const review = () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setConfirming(true);
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await leaveApi.adjustment({
        user_id: userId,
        leave_type_name: leaveTypeName.trim(),
        amount: Number(amount),
        note: note.trim(),
        effective_date: effectiveDate || undefined,
      });
      onNotice('Ledger adjustment recorded.');
      setUserId('');
      setLeaveTypeName('');
      setAmount('');
      setEffectiveDate('');
      setNote('');
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record adjustment.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20';
  const labelCls = 'text-xs font-semibold text-[#0F172A]';
  const selectedUser = users.find((u) => u.id === userId);

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-[#64748B]">
        Manually credit or deduct leave balance. Every adjustment is appended to the audit-tracked ledger — it is never edited or deleted.
      </p>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="af-user" className={labelCls}>User *</label>
          <select id="af-user" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={confirming} className={inputCls}>
            <option value="">Select…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="af-type" className={labelCls}>Leave type *</label>
          <input id="af-type" list="af-type-list" value={leaveTypeName} onChange={(e) => setLeaveTypeName(e.target.value)} disabled={confirming} className={inputCls} placeholder="e.g. casual" />
          <datalist id="af-type-list">
            {LEAVE_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="af-amount" className={labelCls}>Amount * <span className="font-normal text-[#94A3B8]">(+ credit / − deduct)</span></label>
          <input id="af-amount" type="number" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={confirming} className={inputCls} placeholder="e.g. 1.5 or -2" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="af-date" className={labelCls}>Effective date</label>
          <input id="af-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} disabled={confirming} className={inputCls} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="af-note" className={labelCls}>Note *</label>
        <textarea id="af-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={confirming} rows={2} className={inputCls} />
      </div>

      {confirming ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            Confirm: adjust <strong>{selectedUser?.label}</strong>’s <strong>{leaveTypeName}</strong> balance by{' '}
            <strong>{Number(amount) > 0 ? `+${amount}` : amount}</strong> day(s)?
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-white disabled:opacity-60">
              Back
            </button>
            <button type="button" onClick={submit} disabled={submitting} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
              {submitting ? 'Recording…' : 'Confirm adjustment'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={review} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699]">
          Review adjustment
        </button>
      )}
    </div>
  );
}
