'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Modal, PageSection } from '@platform/ui-kit';
import { payroll } from '../../lib/api/client';
import { formatMonth, type PayrollReadiness } from '../../lib/payroll/types';
import { formatDateTime } from '../../lib/attendance/format';
import { fieldInputCls, stateBlockCls } from '../../lib/ui';

type Tone = 'ok' | 'attention';

interface Check {
  key: string;
  label: string;
  hint: string;
  count: number;
  href?: string;
  linkLabel?: string;
}

/**
 * Month-end sign-off (Stitch "Monthly Attendance & Payroll Report Matrix" → reconciliation panel).
 * A checklist of what is still open for a month, then the lock that hands it to payroll. The
 * counts are advisory: HR may lock with items open (after confirming), because a real month always
 * has stragglers, but they are told exactly what they are locking over.
 */
export default function MonthEndReport() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<PayrollReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    setData(null);
    payroll.readiness(month).then((r) => setData(r.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the checklist.'));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const checks: Check[] = data
    ? [
        { key: 'reg', label: 'Corrections waiting', hint: 'attendance regularizations pending a decision', count: data.pending_regularizations, href: '/attendance/team', linkLabel: 'Review' },
        { key: 'leave', label: 'Leave waiting', hint: 'leave requests in this month still pending', count: data.pending_leave, href: '/leave/approvals', linkLabel: 'Review' },
        { key: 'missed', label: 'Missed punches', hint: 'days with a check-in that was never closed', count: data.missed_punch_days, href: '/attendance/team', linkLabel: 'Fix' },
        { key: 'draft', label: 'Payslips not published', hint: 'drafts prepared but not yet visible to employees', count: data.draft_payslips, href: '/payroll', linkLabel: 'Publish' },
      ]
    : [];
  const open = checks.reduce((n, c) => n + c.count, 0);
  const locked = data?.status === 'locked';

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); setNotice(done); load(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); } finally { setBusy(false); setConfirming(false); }
  };

  return (
    <PageSection title="Month-end sign-off">
      <div className="space-y-3">
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap items-center gap-3">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" className={`${fieldInputCls} w-44`} />
          {data && (
            <span className={`rounded-full px-2.5 py-0.5 text-label-sm font-semibold ${locked ? 'bg-status-due-container text-on-status-due-container' : 'bg-surface-container text-on-surface-variant'}`}>
              {locked ? `Locked ${data.locked_at ? formatDateTime(data.locked_at) : ''}` : 'Open'}
            </span>
          )}
          {data && <span className="text-xs text-on-surface-variant">{data.headcount} active employees · {data.published_payslips} payslips published</span>}
        </div>

        {!data ? <div className={stateBlockCls}>Loading…</div> : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {checks.map((c) => {
                const tone: Tone = c.count === 0 ? 'ok' : 'attention';
                return (
                  <li key={c.key} className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
                    <span className={`absolute inset-y-0 left-0 w-1 ${tone === 'ok' ? 'bg-status-success' : 'bg-status-due'}`} aria-hidden="true" />
                    <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{c.label}</p>
                    <p className="mt-1 font-mono text-headline-lg font-bold tabular-nums text-on-surface">{c.count}</p>
                    <p className="text-label-sm text-on-surface-variant">{tone === 'ok' ? 'All clear' : c.hint}</p>
                    {c.count > 0 && c.href && <Link href={c.href} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">{c.linkLabel} →</Link>}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3">
              <p className="text-sm text-on-surface-variant">
                {locked
                  ? `${formatMonth(`${month}-01`)} is locked: attendance corrections and recomputes for it are refused.`
                  : open === 0
                    ? `${formatMonth(`${month}-01`)} is ready to lock.`
                    : `${open} item${open === 1 ? '' : 's'} still open for ${formatMonth(`${month}-01`)}. You can lock anyway.`}
              </p>
              {locked
                ? <Button variant="secondary" disabled={busy} onClick={() => void run(() => payroll.unlock(month), 'Month unlocked.')}>Unlock month</Button>
                : <Button variant="primary" disabled={busy} onClick={() => (open === 0 ? void run(() => payroll.lock(month), 'Month locked — hand it to payroll.') : setConfirming(true))}>Lock for payroll</Button>}
            </div>
          </>
        )}
      </div>

      {confirming && (
        <Modal open onClose={() => setConfirming(false)} title="Lock with items still open?" locked={busy} maxWidth="max-w-md"
          footer={<div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant">Not yet</button>
            <button type="button" onClick={() => void run(() => payroll.lock(month), 'Month locked — hand it to payroll.')} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary">{busy ? 'Locking…' : 'Lock anyway'}</button>
          </div>}>
          <p className="text-sm text-on-surface-variant">
            {open} item{open === 1 ? ' is' : 's are'} still open. Once locked, attendance corrections for {formatMonth(`${month}-01`)} are refused, so anything still pending can no longer change the figures. You can unlock the month later if you need to.
          </p>
        </Modal>
      )}
    </PageSection>
  );
}
