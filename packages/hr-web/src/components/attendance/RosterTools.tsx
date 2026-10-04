'use client';

import { useState } from 'react';
import { Button, Modal, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { attendanceTools } from '../../lib/api/client';
import type { TeamDayRow } from '../../lib/attendance/types';
import { fieldInputCls, fieldLabelCls } from '../../lib/ui';

// The statuses HR may stamp on a day in bulk. not_marked / missed_punch are outcomes, not decisions.
const STATUS_CHOICES = [
  ['present', 'Present'],
  ['half_day', 'Half day'],
  ['wfh', 'Work from home'],
  ['on_leave', 'On leave'],
  ['absent', 'Absent'],
] as const;

interface ToolbarProps {
  rows: TeamDayRow[];
  date: string;
  selected: Set<string>;
  onClear: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Daily roster actions for people holding hr.attendance.admin.override: remind the people who
 * have not punched, and mark several people's day at once. The server re-checks the
 * capability, the branch, the payroll lock, and audits every person touched.
 */
export function RosterToolbar({ rows, date, selected, onClear, onDone, onError }: ToolbarProps) {
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const unmarked = rows.filter((r) => r.status_name === 'not_marked').map((r) => r.user_id);
  // With a selection, nudge exactly those; otherwise everyone still unmarked.
  const nudgeTargets = selected.size > 0 ? [...selected] : unmarked;

  const nudge = async () => {
    setBusy(true);
    try {
      const r = await attendanceTools.nudge({ user_ids: nudgeTargets, work_date: date });
      onDone(r.data.nudged === 0 ? 'No one needed a reminder — everyone selected has already punched.' : `Reminder sent to ${r.data.nudged} ${r.data.nudged === 1 ? 'person' : 'people'}.`);
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not send reminders.'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
        <span className="text-xs text-on-surface-variant">{selected.size > 0 ? `${selected.size} selected` : `${unmarked.length} not marked`}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy || nudgeTargets.length === 0} onClick={nudge}>
            Nudge {selected.size > 0 ? 'selected' : 'unmarked'}
          </Button>
          <Button variant="primary" disabled={busy || selected.size === 0} onClick={() => setBulkOpen(true)}>Bulk regularize</Button>
          {selected.size > 0 && <Button variant="ghost" onClick={onClear}>Clear</Button>}
        </div>
      </div>
      {bulkOpen && (
        <BulkModal
          count={selected.size}
          onClose={() => setBulkOpen(false)}
          onSubmit={async (status, reason) => {
            const r = await attendanceTools.bulkRegularize({ user_ids: [...selected], work_date: date, status_name: status, reason });
            setBulkOpen(false);
            onClear();
            const skipped = r.data.results.filter((x) => !x.ok);
            onDone(skipped.length === 0 ? `${r.data.succeeded} ${r.data.succeeded === 1 ? 'day' : 'days'} regularized.` : `${r.data.succeeded} regularized, ${skipped.length} skipped (${skipped[0]!.error}).`);
          }}
        />
      )}
    </>
  );
}

function BulkModal({ count, onClose, onSubmit }: { count: number; onClose: () => void; onSubmit: (status: string, reason: string) => Promise<void> }) {
  const [status, setStatus] = useState<string>('present');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    if (!reason.trim()) { setError('A reason is required — it is kept in the audit trail.'); return; }
    setBusy(true);
    try { await onSubmit(status, reason.trim()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not regularize.'); setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={go} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Working…' : `Regularize ${count}`}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Regularize ${count} ${count === 1 ? 'person' : 'people'}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <p className="text-xs text-on-surface-variant">Sets the same status for the selected day. It overrides what their punches show, so use it for cases like a gate outage. Each person is audited.</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="br-status" className={fieldLabelCls}>Mark as</label>
          <select id="br-status" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldInputCls} disabled={busy}>
            {STATUS_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="br-reason" className={fieldLabelCls}>Reason</label>
            <SpeechInputButton onText={(t) => setReason((p) => appendDictation(p, t, 500))} disabled={busy} />
          </div>
          <textarea id="br-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}

/** Add a missed check-in or check-out for one person. */
export function ManualPunchModal({ row, date, onClose, onDone }: { row: TeamDayRow; date: string; onClose: () => void; onDone: (message: string) => void }) {
  const [type, setType] = useState<'check_in' | 'check_out'>('check_in');
  const [when, setWhen] = useState(`${date}T09:00`);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    if (!when || !reason.trim()) { setError('Pick the time and give a reason.'); return; }
    setBusy(true);
    try {
      await attendanceTools.manualPunch({ user_id: row.user_id, event_type: type, occurred_at: new Date(when).toISOString(), reason: reason.trim() });
      onDone(`Added a ${type === 'check_in' ? 'check-in' : 'check-out'} for ${row.user_full_name}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the punch.'); setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={go} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Adding…' : 'Add punch'}</button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Add a punch for ${row.user_full_name}`} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <p className="text-xs text-on-surface-variant">Recorded as “added by HR” with your name and the reason, and the day is recalculated from its punches.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mp-type" className={fieldLabelCls}>Type</label>
            <select id="mp-type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={fieldInputCls} disabled={busy}>
              <option value="check_in">Check in</option><option value="check_out">Check out</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mp-when" className={fieldLabelCls}>When</label>
            <input id="mp-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={fieldInputCls} disabled={busy} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mp-reason" className={fieldLabelCls}>Reason</label>
            <SpeechInputButton onText={(t) => setReason((p) => appendDictation(p, t, 500))} disabled={busy} />
          </div>
          <textarea id="mp-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={`${fieldInputCls} h-auto py-2`} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}
