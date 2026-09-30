'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, PageSection } from '@platform/ui-kit';
import { attendanceReportReach } from '@hr/authz';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { MusterCode, MusterParams, MusterReport as MusterReportData } from '../../lib/attendance/types';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';

interface Props {
  actor: SessionUser;
}

const ALL = '__all__';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** DD/MM/YYYY, as the paper muster writes it. */
function dmy(date: string | null): string {
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—';
}

const CODE_CLS: Record<Exclude<MusterCode, ''>, string> = {
  P: 'text-[#15803D]',
  HD: 'bg-[#FEF9C3] text-[#854D0E]',
  'HD/L': 'bg-[#FEF9C3] text-[#854D0E]',
  A: 'bg-[#FEE2E2] text-[#B91C1C]',
  L: 'bg-[#DBEAFE] text-[#1D4ED8]',
  LOP: 'bg-[#FECACA] text-[#991B1B]',
  WO: 'bg-[#F1F5F9] text-[#64748B]',
  H: 'bg-[#E2E8F0] text-[#334155]',
};

const LEGEND: Array<[Exclude<MusterCode, ''>, string]> = [
  ['P', 'Present'],
  ['HD', 'Half day'],
  ['HD/L', 'Half day + half paid leave'],
  ['A', 'Absent / missed punch'],
  ['L', 'Paid leave'],
  ['LOP', 'Loss of pay'],
  ['WO', 'Weekly off'],
  ['H', 'Holiday'],
];

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The combined attendance sheet: one row per employee, one cell per day, then
 * the paid-day totals — the layout HR teams keep by hand for payroll.
 *
 * Branch reach follows the navbar branch switcher: a session on "All branches"
 * opens on every branch, a session on one branch opens on that branch. Holders of
 * the tenant scope can re-pick here; everyone else only ever sees their branch.
 * The service re-checks the same scope, so this picker is a convenience, not the
 * boundary.
 */
export default function MusterReport({ actor }: Props) {
  const tenantReach = attendanceReportReach(actor) === 'tenant';
  const [month, setMonth] = useState(currentMonth());
  const [selection, setSelection] = useState<string>(tenantReach && actor.all_branches ? ALL : actor.org_id);
  const [data, setData] = useState<MusterReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params: MusterParams = useMemo(() => {
    if (!tenantReach) return { month, branch: 'current' };
    return selection === ALL ? { month, branch: 'all' } : { month, branch: 'all', org_id: selection };
  }, [tenantReach, month, selection]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    attendanceApi
      .reportsMuster(params)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the report.'))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const download = () => {
    const a = document.createElement('a');
    a.href = attendanceApi.reportMusterDownloadUrl(params);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const rows = data?.rows ?? [];
  const dayNumbers = Array.from({ length: data?.days_in_month ?? 0 }, (_, i) => i + 1);
  const showBranch = tenantReach && selection === ALL;

  return (
    <PageSection
      title={data ? `Combined attendance — ${data.scope_label}` : 'Combined attendance'}
      action={
        <button
          type="button"
          onClick={download}
          disabled={loading || rows.length === 0}
          title={rows.length === 0 ? 'Nothing to export' : 'Download this sheet as Excel'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] shadow-sm transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
          Download Excel
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mr-month" className={fieldLabelCls}>Month</label>
          <input
            id="mr-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={`${fieldInputCls} w-48`}
          />
        </div>
        {tenantReach && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mr-branch" className={fieldLabelCls}>Branch</label>
            <select
              id="mr-branch"
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              className={`${fieldInputCls} w-56`}
            >
              <option value={ALL}>All branches</option>
              {(data?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {LEGEND.map(([code, label]) => (
          <span key={code} className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-1.5 py-0.5 text-[#475569]">
            <span className={`rounded px-1 font-semibold ${CODE_CLS[code]}`}>{code}</span>
            {label}
          </span>
        ))}
      </div>

      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      {loading ? (
        <div className={stateBlockCls}>Loading…</div>
      ) : rows.length === 0 ? (
        <p className={emptyBlockCls}>No attendance data for {month}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#FEF9C3] text-left font-semibold text-[#0F172A]">
                <th className="sticky left-0 z-10 bg-[#FEF9C3] px-2 py-2">SL</th>
                <th className="sticky left-8 z-10 min-w-[160px] bg-[#FEF9C3] px-2 py-2">Name</th>
                <th className="px-2 py-2">Profile</th>
                <th className="px-2 py-2">Department</th>
                <th className="px-2 py-2">DOJ</th>
                {showBranch && <th className="px-2 py-2">Branch</th>}
                {dayNumbers.map((d) => (
                  <th key={d} className="w-8 px-0 py-2 text-center">{d}</th>
                ))}
                <th className="px-2 py-2 text-right">Present</th>
                <th className="px-2 py-2 text-right">Weekoff</th>
                <th className="px-2 py-2 text-right">Paid leave</th>
                <th className="px-2 py-2 text-right">Holidays</th>
                <th className="px-2 py-2 text-right">Total paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.org_id}|${r.user_id}`} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="sticky left-0 bg-white px-2 py-1.5 text-[#94A3B8]">{r.sl_no}</td>
                  <td className="sticky left-8 min-w-[160px] bg-white px-2 py-1.5">
                    <p className="font-medium text-[#0F172A]">{r.name}</p>
                    {r.employee_code && <p className="text-[10px] text-[#94A3B8]">{r.employee_code}</p>}
                  </td>
                  <td className="px-2 py-1.5 text-[#475569]">{r.designation ?? '—'}</td>
                  <td className="px-2 py-1.5 text-[#475569]">{r.department ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[#475569]">{dmy(r.date_of_joining)}</td>
                  {showBranch && <td className="whitespace-nowrap px-2 py-1.5 text-[#475569]">{r.branch}</td>}
                  {r.days.map((code, i) => (
                    <td key={i} className={`border-l border-[#F1F5F9] px-0 py-1.5 text-center font-semibold ${code ? CODE_CLS[code] : ''}`}>
                      {code}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-medium text-[#0F172A]">{num(r.present)}</td>
                  <td className="px-2 py-1.5 text-right text-[#475569]">{num(r.weekoff_paid)}</td>
                  <td className="px-2 py-1.5 text-right text-[#475569]">{num(r.paid_leave)}</td>
                  <td className="px-2 py-1.5 text-right text-[#475569]">{num(r.holidays)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-[#0F172A]">{num(r.total_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-[#94A3B8]">
        Half day counts as 0.5. Total paid = present + weekly offs + paid leave + holidays. The Excel download adds a blank Final Paid Days column for HR.
      </p>
    </PageSection>
  );
}
