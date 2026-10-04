'use client';

import { useEffect, useState } from 'react';
import { Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { compOff } from '../../lib/api/client';
import { todayIso } from '../../lib/attendance/format';
import { fieldInputCls, fieldLabelCls } from '../../lib/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onClaimed: () => void;
}

/**
 * Claim a day off for work done on a day off. The server decides whether the date
 * qualifies (a weekly off or holiday of THIS employee, not in the future, within
 * the backdate window) and says why when it does not — the form only collects the
 * three facts and shows that message.
 */
export default function CompOffClaimModal({ open, onClose, onClaimed }: Props) {
  const [workedDate, setWorkedDate] = useState('');
  const [days, setDays] = useState<0.5 | 1>(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWorkedDate('');
    setDays(1);
    setReason('');
    setError(null);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    if (!workedDate) { setError('Pick the day you worked.'); return; }
    if (!reason.trim()) { setError('Say what you worked on.'); return; }
    setBusy(true);
    try {
      await compOff.claim({ worked_date: workedDate, days, reason: reason.trim() });
      onClaimed();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the claim.');
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">
        Cancel
      </button>
      <button type="button" onClick={submit} disabled={busy}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60">
        {busy ? 'Submitting…' : 'Submit claim'}
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Claim comp-off" locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
        )}
        <p className="text-xs text-on-surface-variant">
          Worked on a weekly off or a holiday? Claim a day back. Once your approver agrees it is added to your Comp-off balance and stays usable for 90 days.
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="co-date" className={fieldLabelCls}>Day worked</label>
          <input id="co-date" type="date" max={todayIso()} value={workedDate} onChange={(e) => setWorkedDate(e.target.value)} className={fieldInputCls} disabled={busy} />
        </div>

        <fieldset className="flex flex-col gap-1.5" disabled={busy}>
          <legend className={fieldLabelCls}>How much</legend>
          <div className="flex gap-2">
            {([[1, 'Full day'], [0.5, 'Half day']] as const).map(([value, label]) => (
              <label key={value} className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                days === value ? 'border-primary bg-primary-fixed text-on-primary-fixed' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
              }`}>
                <input type="radio" name="co-days" className="sr-only" checked={days === value} onChange={() => setDays(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="co-reason" className={fieldLabelCls}>What did you work on?</label>
            <SpeechInputButton onText={(t) => setReason((p) => appendDictation(p, t, 500))} disabled={busy} />
          </div>
          <textarea id="co-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}
