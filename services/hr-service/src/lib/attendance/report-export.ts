// ─────────────────────────────────────────────────────────────────────────────
// Attendance report file rendering (csv / xlsx). No I/O beyond building buffers.
//
// SECURITY NOTE (exceljs): exceljs pins uuid@8.3.2, which has an open advisory
// (missing buffer bounds check). It affects uuid v3/v5/v6 ONLY when a `buf`
// argument is passed; exceljs imports just v4 (`const {v4: uuidv4} =
// require('uuid')`), so it is not reachable. Left un-overridden deliberately:
// forcing uuid 8 -> 11 is a three-major jump inside exceljs for no security
// gain. Re-check if exceljs is upgraded.
// ─────────────────────────────────────────────────────────────────────────────

import { formatMinutes, type DetailReport } from './report-detail.js';

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
}

/** RFC 4180 field quoting. */
export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: ReportColumn[], rows: Array<Record<string, unknown>>): string {
  return [
    columns.map((c) => csvEscape(c.header)).join(','),
    ...rows.map((r) => columns.map((c) => csvEscape(r[c.key])).join(',')),
  ].join('\n');
}

/**
 * Summary rows with the counts as numbers. They come from the view as Postgres
 * bigint, which the driver returns as strings — written as-is, Excel stores them
 * as text and SUM() over the column yields 0.
 */
export function numericSummaryRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    for (const k of Object.keys(out)) {
      if ((k.endsWith('_count') || k === 'avg_worked_minutes') && out[k] != null) out[k] = Number(out[k]);
    }
    return out;
  });
}

export const SUMMARY_COLUMNS: ReportColumn[] = [
  { key: 'user_full_name', header: 'Employee', width: 24 },
  { key: 'user_email', header: 'Email', width: 30 },
  { key: 'month', header: 'Month', width: 9 },
  { key: 'present_count', header: 'Present', width: 9 },
  { key: 'absent_count', header: 'Absent', width: 9 },
  { key: 'half_day_count', header: 'Half Day', width: 9 },
  { key: 'missed_punch_count', header: 'Missed Punch', width: 13 },
  { key: 'on_leave_count', header: 'On Leave', width: 9 },
  { key: 'holiday_count', header: 'Holiday', width: 9 },
  { key: 'weekly_off_count', header: 'Weekly Off', width: 11 },
  { key: 'wfh_count', header: 'WFH', width: 7 },
  { key: 'late_count', header: 'Late', width: 7 },
  { key: 'early_exit_count', header: 'Early Exit', width: 10 },
  { key: 'avg_worked_minutes', header: 'Avg Worked (min)', width: 16 },
];

const DAY_COLUMNS: ReportColumn[] = [
  { key: 'user_full_name', header: 'Employee', width: 24 },
  { key: 'user_email', header: 'Email', width: 30 },
  { key: 'work_date', header: 'Date', width: 12 },
  { key: 'weekday', header: 'Day', width: 6 },
  { key: 'status_label', header: 'Status', width: 16 },
  { key: 'remarks', header: 'Remarks', width: 48 },
  { key: 'shift', header: 'Shift', width: 22 },
  { key: 'first_in', header: 'First In', width: 9 },
  { key: 'last_out', header: 'Last Out', width: 9 },
  { key: 'session_count', header: 'Sessions', width: 9 },
  { key: 'sessions', header: 'Check-in / Check-out', width: 44 },
  { key: 'worked', header: 'Worked', width: 9 },
  { key: 'late', header: 'Late', width: 6 },
  { key: 'early_exit', header: 'Early Exit', width: 10 },
  { key: 'wfh_label', header: 'WFH', width: 6 },
  { key: 'regularization', header: 'Regularization', width: 48 },
];

const SESSION_COLUMNS: ReportColumn[] = [
  { key: 'user_full_name', header: 'Employee', width: 24 },
  { key: 'user_email', header: 'Email', width: 30 },
  { key: 'work_date', header: 'Date', width: 12 },
  { key: 'seq', header: 'Session #', width: 10 },
  { key: 'check_in', header: 'Check-in', width: 10 },
  { key: 'check_out', header: 'Check-out', width: 10 },
  { key: 'duration', header: 'Duration', width: 10 },
  { key: 'location', header: 'Location', width: 10 },
  { key: 'note', header: 'Note', width: 50 },
];

const yesNo = (b: boolean) => (b ? 'Yes' : '');

function dayRows(report: DetailReport): Array<Record<string, unknown>> {
  return report.days.map((d) => ({
    ...d,
    worked: formatMinutes(d.worked_minutes),
    late: yesNo(d.is_late),
    early_exit: yesNo(d.is_early_exit),
    wfh_label: yesNo(d.wfh),
  }));
}

/** The Daily Detail sheet alone — the csv form of the detailed report. */
export function detailCsv(report: DetailReport): string {
  // BOM so Excel opens the UTF-8 (en dashes, names) correctly.
  return `﻿${toCsv(DAY_COLUMNS, dayRows(report))}`;
}

// Row fill per displayed status (ARGB). Anything unlisted stays white.
const STATUS_FILL: Record<string, string> = {
  weekly_off: 'FFF1F5F9',
  not_employed: 'FFF8FAFC',
  holiday: 'FFE2E8F0',
  on_leave: 'FFDBEAFE',
  half_day: 'FFFEF9C3',
  absent: 'FFFEE2E2',
  not_marked: 'FFFEE2E2',
  missed_punch: 'FFFED7AA',
  in_progress: 'FFDCFCE7',
  unresolved: 'FFFEF3C7',
};

export async function detailXlsx(
  month: string,
  summary: Array<Record<string, unknown>>,
  report: DetailReport,
): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  const addSheet = (name: string, columns: ReportColumn[], rows: Array<Record<string, unknown>>) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 12 }));
    for (const r of rows) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  };

  addSheet(`Summary ${month}`, SUMMARY_COLUMNS, numericSummaryRows(summary));

  const days = addSheet('Daily Detail', DAY_COLUMNS, dayRows(report));
  report.days.forEach((d, i) => {
    const row = days.getRow(i + 2);
    const argb = STATUS_FILL[d.status_key];
    if (argb) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    if (d.is_regularized) row.font = { italic: true };
  });

  const sessions = addSheet(
    'Punches',
    SESSION_COLUMNS,
    report.sessions.map((s) => ({ ...s, duration: formatMinutes(s.minutes) })),
  );
  report.sessions.forEach((s, i) => {
    if (!s.counted) sessions.getRow(i + 2).font = { color: { argb: 'FFB45309' } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
