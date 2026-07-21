'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, DownloadButton, PageSection, type ExportFormat } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../../lib/api/client';
import type { MonthlySummaryRow } from '../../../lib/attendance/types';
import { formatWorkedMinutes } from '../../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, fieldLabelCls, stateBlockCls } from '../../../lib/ui';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function MonthlySummaryReport() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<MonthlySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    attendanceApi
      .reportsSummary({ month })
      .then((res) => setRows(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the report.'))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const handleExport = (format: ExportFormat) => {
    const url = attendanceApi.reportDownloadUrl({ month, format });
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <PageSection
      title="Monthly summary"
      action={<DownloadButton onExport={handleExport} rowCount={rows.length} disabled={loading} />}
    >
      {/* The month picker was the page's only visible control and carried a
          bold near-black label, so it read as a section heading rather than a
          filter. It now sits under the section title with the same muted field
          label as every other input on these screens. */}
      <div className="mb-3 flex flex-col gap-1.5">
        <label htmlFor="msr-month" className={fieldLabelCls}>Month</label>
        <input
          id="msr-month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className={`${fieldInputCls} w-48`}
        />
      </div>

      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      {loading ? (
        <div className={stateBlockCls}>Loading…</div>
      ) : rows.length === 0 ? (
        <p className={emptyBlockCls}>No attendance data for {month}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Present</th>
                <th className="px-4 py-3">Absent</th>
                <th className="px-4 py-3">Half day</th>
                <th className="px-4 py-3">On leave</th>
                <th className="px-4 py-3">Holiday</th>
                <th className="px-4 py-3">Weekly off</th>
                <th className="px-4 py-3">WFH</th>
                <th className="px-4 py-3">Late</th>
                <th className="px-4 py-3">Early exit</th>
                <th className="px-4 py-3">Avg worked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#0F172A]">{r.user_full_name}</p>
                    <p className="text-[11px] text-[#94A3B8]">{r.user_email}</p>
                  </td>
                  <td className="px-4 py-3 text-[#475569]">{r.present_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.absent_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.half_day_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.on_leave_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.holiday_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.weekly_off_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.wfh_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.late_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{r.early_exit_count}</td>
                  <td className="px-4 py-3 text-[#475569]">{formatWorkedMinutes(r.avg_worked_minutes != null ? Math.round(r.avg_worked_minutes) : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageSection>
  );
}
