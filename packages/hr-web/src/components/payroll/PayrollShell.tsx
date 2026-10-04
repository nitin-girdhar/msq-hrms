'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, Button, Modal, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { hrEmployees, payroll, statutory } from '../../lib/api/client';
import type { StatutoryValues } from '../../lib/h7/types';
import { groupByFinancialYear } from '../../lib/payroll/fy';
import { printPayslip } from '../../lib/payroll/printPayslip';
import StatCard from '../common/StatCard';
import StatusPill from '../common/StatusPill';
import type { PayrollOverview, PayslipDetail, PayslipLine, PayslipSummary } from '../../lib/payroll/types';
import { formatMonth, formatMoney } from '../../lib/payroll/types';
import type { EmployeeProfileView } from '../../lib/leave/types';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

interface Props {
  actor: SessionUser;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Payslips (Stitch "Payroll & Payslips"). Employees read their own published
 * payslips; people who manage payroll also get a section to prepare, publish and
 * lock a month. This is a viewer, not a payroll engine: HR types the lines, the
 * server totals them. Tax planning, regime comparison, Form 16 and bank files from
 * the design are not built.
 */
export default function PayrollShell({ actor }: Props) {
  const canView = can(actor, CAPABILITY.HR_EMPLOYEES_PAYSLIP_VIEW);
  const canManage = can(actor, CAPABILITY.HR_REPORTS_PAYROLL_MANAGE);

  const [mine, setMine] = useState<PayslipSummary[]>([]);
  const [loading, setLoading] = useState(canView);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fy, setFy] = useState<string | null>(null);
  const [bank, setBank] = useState<StatutoryValues | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // The bank card is a nicety on top of the payslips: if it cannot be read it is simply not shown.
  useEffect(() => {
    if (!canView) return;
    statutory.mine().then((r) => setBank(r.data)).catch(() => setBank(null));
  }, [canView]);

  const download = async (id: string) => {
    setDownloading(id);
    try {
      const r = await payroll.getMine(id);
      if (!printPayslip(r.data)) setError('Your browser blocked the pop-up. Allow pop-ups for this site and try again.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the payslip.'); } finally { setDownloading(null); }
  };

  useEffect(() => {
    if (!canView) return;
    payroll.mine().then((r) => setMine(r.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load your payslips.')).finally(() => setLoading(false));
  }, [canView]);

  const latest = mine[0];
  const previous = mine[1];
  const years = groupByFinancialYear(mine);
  const activeFy = years.find((y) => y.fy === fy) ?? years[0];
  const delta = latest && previous ? latest.net - previous.net : null;

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader title="Payroll" subtitle="Your payslips, and payroll tools for HR." />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {canView && (
          <>
            {latest && (
              <>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <StatCard label={`Net take-home · ${formatMonth(latest.period)}`} value={formatMoney(latest.net)} tone="primary"
                    hint={delta === null ? 'first published payslip' : `${delta >= 0 ? '+' : '-'}${formatMoney(Math.abs(delta))} vs ${formatMonth(previous!.period)}`}
                    action={<button type="button" onClick={() => setOpenId(latest.id)} className="text-xs font-semibold text-primary hover:underline">View breakdown →</button>} />
                  <StatCard label="Gross earnings" value={formatMoney(latest.gross)} tone="success" hint={`${latest.working_days ?? '-'} working days${latest.lop_days ? ` · ${latest.lop_days} LOP` : ''}`} />
                  <StatCard label="Deductions" value={formatMoney(latest.deductions)} tone="due"
                    hint={latest.gross > 0 ? `${Math.round((latest.deductions / latest.gross) * 1000) / 10}% of gross` : undefined} />
                  <StatCard label="Payslips published" value={mine.length} tone="info" hint={`${years.length} financial year${years.length === 1 ? '' : 's'}`} />
                </div>
                {bank && (bank.bank_name || bank.account_number) && (
                  <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">Bank &amp; compliance details</h3>
                      <p className="text-xs text-on-surface-variant">
                        {[bank.bank_name, bank.bank_branch].filter(Boolean).join(', ') || 'Bank'}
                        {bank.account_number ? ` · account ending ${bank.account_number.slice(-4)}` : ''}
                        {bank.ifsc ? ` · IFSC ${bank.ifsc}` : ''}
                      </p>
                    </div>
                    <a href="/profile" className="text-xs font-semibold text-primary hover:underline">Request a change →</a>
                  </section>
                )}
              </>
            )}

            <PageSection title="Payslip archive">
              {loading ? (
                <div className={stateBlockCls}>Loading…</div>
              ) : mine.length === 0 ? (
                <p className={emptyBlockCls}>No payslips have been published for you yet.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2" role="tablist" aria-label="Financial year">
                    {years.map((y) => (
                      <button key={y.fy} type="button" role="tab" aria-selected={activeFy?.fy === y.fy} onClick={() => setFy(y.fy)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${activeFy?.fy === y.fy ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'}`}>
                        {y.fy} ({y.items.length})
                      </button>
                    ))}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                          <th className="px-4 py-2.5">Pay period</th><th className="px-4 py-2.5">Days</th><th className="px-4 py-2.5 text-right">Gross</th>
                          <th className="px-4 py-2.5 text-right">Deductions</th><th className="px-4 py-2.5 text-right">Net pay</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeFy?.items ?? []).map((p) => (
                          <tr key={p.id} className="border-b border-outline-variant/50 last:border-0">
                            <td className="px-4 py-2.5 font-semibold text-on-surface">{formatMonth(p.period)}</td>
                            <td className="px-4 py-2.5 text-on-surface-variant">{p.working_days ?? '-'}{p.lop_days ? ` (${p.lop_days} LOP)` : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-on-surface">{formatMoney(p.gross)}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-status-overdue">{formatMoney(p.deductions)}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-on-surface">{formatMoney(p.net)}</td>
                            <td className="px-4 py-2.5"><StatusPill tone="success">Published</StatusPill></td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="secondary" onClick={() => setOpenId(p.id)}>View</Button>
                                <Button variant="secondary" disabled={downloading === p.id} onClick={() => void download(p.id)}>{downloading === p.id ? '…' : 'PDF'}</Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </PageSection>
          </>
        )}

        {canManage && <AdminSection onNotice={setNotice} onError={setError} />}
        {!canView && !canManage && <p className={emptyBlockCls}>Nothing is enabled for your role here yet.</p>}
      </PageBody>

      {openId && <PayslipModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PayslipModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [slip, setSlip] = useState<PayslipDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    payroll.getMine(id).then((r) => setSlip(r.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the payslip.'));
  }, [id]);

  const part = (kind: PayslipLine['kind'], title: string) => (
    <div>
      <h3 className="mb-1 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{title}</h3>
      <ul className="divide-y divide-outline-variant/50 rounded-lg border border-outline-variant">
        {slip!.lines.filter((l) => l.kind === kind).map((l, i) => (
          <li key={`${l.label}-${i}`} className="flex justify-between gap-3 px-3 py-1.5 text-sm"><span className="text-on-surface">{l.label}</span><span className="tabular-nums text-on-surface">{formatMoney(l.amount)}</span></li>
        ))}
      </ul>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={slip ? `Payslip · ${formatMonth(slip.period)}` : 'Payslip'} maxWidth="max-w-lg" closeOnBackdropClick
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={!slip} onClick={() => { if (slip && !printPayslip(slip)) setError('Your browser blocked the pop-up. Allow pop-ups for this site and try again.'); }}>Download PDF</Button><Button variant="primary" onClick={onClose}>Close</Button></div>}>
      {error && <Alert tone="error">{error}</Alert>}
      {!slip && !error && <div className={stateBlockCls}>Loading…</div>}
      {slip && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-on-surface-variant">{slip.user_full_name}{slip.employee_code ? ` · ${slip.employee_code}` : ''}
            {slip.working_days != null ? ` · ${slip.working_days} working days` : ''}{slip.lop_days ? ` · ${slip.lop_days} LOP` : ''}</p>
          {slip.gross > 0 && (
            <div>
              <div className="flex h-2 overflow-hidden rounded-full bg-surface-container" role="img" aria-label="Share of gross that is take-home">
                <span className="bg-status-success" style={{ width: `${Math.max(0, Math.min(100, (slip.net / slip.gross) * 100))}%` }} />
                <span className="bg-status-overdue" style={{ width: `${Math.max(0, Math.min(100, (slip.deductions / slip.gross) * 100))}%` }} />
              </div>
              <p className="mt-1 flex justify-between text-label-sm text-on-surface-variant"><span>Take-home {Math.round((slip.net / slip.gross) * 1000) / 10}%</span><span>Deductions {Math.round((slip.deductions / slip.gross) * 1000) / 10}%</span></p>
            </div>
          )}
          {part('earning', 'Earnings')}
          {part('deduction', 'Deductions')}
          <div className="flex items-center justify-between rounded-lg bg-primary-fixed px-4 py-3">
            <span className="text-sm font-semibold text-on-primary-fixed">Net pay</span>
            <span className="font-mono text-headline-sm font-bold tabular-nums text-on-primary-fixed">{formatMoney(slip.net)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface DraftLine { kind: 'earning' | 'deduction'; label: string; amount: string }

function AdminSection({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<PayrollOverview | null>(null);
  const [people, setPeople] = useState<EmployeeProfileView[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    payroll.overview(month).then((r) => setData(r.data)).catch((e) => onError(e instanceof Error ? e.message : 'Failed to load payroll.'));
  }, [month, onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { hrEmployees.list({ limit: 100, status: 'active' }).then((r) => setPeople(r.data)).catch(() => setPeople([])); }, []);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); onNotice(done); load(); }
    catch (e) { onError(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(false); }
  };

  const drafts = useMemo(() => (data?.payslips ?? []).filter((p) => !p.published_at).length, [data]);
  const locked = data?.status === 'locked';

  return (
    <PageSection title="Payroll tools">
      <div className="space-y-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Pay month" className={`${fieldInputCls} w-44`} />
          <span className={`rounded-full px-2.5 py-0.5 text-label-sm font-semibold ${locked ? 'bg-status-due-container text-on-status-due-container' : 'bg-surface-container text-on-surface-variant'}`}>
            {locked ? 'Locked' : 'Open'}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>Add / edit payslip</Button>
            <Button variant="secondary" disabled={busy || drafts === 0} onClick={() => void run(() => payroll.publish(month), 'Payslips published.')}>Publish {drafts > 0 ? `(${drafts})` : ''}</Button>
            {locked
              ? <Button variant="secondary" disabled={busy} onClick={() => void run(() => payroll.unlock(month), 'Month unlocked.')}>Unlock month</Button>
              : <Button variant="primary" disabled={busy} onClick={() => void run(() => payroll.lock(month), 'Month locked — attendance for it can no longer be corrected.')}>Lock month</Button>}
          </div>
        </div>
        <p className="text-xs text-on-surface-variant">Locking stops new attendance corrections and recomputes for the month, so the figures you take to payroll cannot move. Publishing makes drafts visible to their employees; a published payslip can no longer be edited.</p>
        {!data ? <div className={stateBlockCls}>Loading…</div> : data.payslips.length === 0 ? <p className={emptyBlockCls}>No payslips for this month yet.</p> : (
          <ul className="divide-y divide-outline-variant/50 rounded-lg border border-outline-variant">
            {data.payslips.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-on-surface">{p.user_full_name}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-on-surface-variant">{formatMoney(p.net)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium ${p.published_at ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'}`}>{p.published_at ? 'Published' : 'Draft'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <DraftModal month={month} people={people} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onNotice('Draft saved.'); load(); }} />}
    </PageSection>
  );
}

function DraftModal({ month, people, onClose, onSaved }: { month: string; people: EmployeeProfileView[]; onClose: () => void; onSaved: () => void }) {
  const [userId, setUserId] = useState('');
  const [workingDays, setWorkingDays] = useState('');
  const [lopDays, setLopDays] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ kind: 'earning', label: 'Basic', amount: '' }, { kind: 'deduction', label: '', amount: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    const clean = lines.filter((l) => l.label.trim() && l.amount !== '').map((l) => ({ kind: l.kind, label: l.label.trim(), amount: Number(l.amount) }));
    if (!userId) { setError('Pick an employee.'); return; }
    if (clean.length === 0 || clean.some((l) => !Number.isFinite(l.amount) || l.amount < 0)) { setError('Add at least one line with a valid amount.'); return; }
    setBusy(true);
    try {
      await payroll.saveDraft({
        user_id: userId, month, lines: clean,
        ...(workingDays !== '' ? { working_days: Number(workingDays) } : {}),
        ...(lopDays !== '' ? { lop_days: Number(lopDays) } : {}),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the draft.');
    } finally { setBusy(false); }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant disabled:opacity-60">Cancel</button>
      <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? 'Saving…' : 'Save draft'}</button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`Payslip draft · ${formatMonth(`${month}-01`)}`} locked={busy} maxWidth="max-w-xl" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pd-emp" className={fieldLabelCls}>Employee</label>
          <select id="pd-emp" value={userId} onChange={(e) => setUserId(e.target.value)} className={fieldInputCls} disabled={busy}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><label htmlFor="pd-wd" className={fieldLabelCls}>Working days</label><input id="pd-wd" type="number" min={0} max={31} step="0.5" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} className={fieldInputCls} disabled={busy} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="pd-lop" className={fieldLabelCls}>LOP days</label><input id="pd-lop" type="number" min={0} max={31} step="0.5" value={lopDays} onChange={(e) => setLopDays(e.target.value)} className={fieldInputCls} disabled={busy} /></div>
        </div>
        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className={fieldLabelCls}>Lines (gross, deductions and net are totalled for you)</legend>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <select aria-label="Line type" value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as DraftLine['kind'] })} className={`${fieldInputCls} w-32 shrink-0`}>
                <option value="earning">Earning</option><option value="deduction">Deduction</option>
              </select>
              <input aria-label="Label" placeholder="Label" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} maxLength={100} className={`${fieldInputCls} min-w-0 flex-1`} />
              <input aria-label="Amount" type="number" min={0} step="0.01" placeholder="0.00" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} className={`${fieldInputCls} w-28 shrink-0`} />
            </div>
          ))}
          <div><Button variant="secondary" onClick={() => setLines((ls) => [...ls, { kind: 'earning', label: '', amount: '' }])}>+ Add line</Button></div>
        </fieldset>
      </div>
    </Modal>
  );
}
