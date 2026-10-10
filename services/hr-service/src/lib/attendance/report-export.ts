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
import { MUSTER_CODES, type MusterCode, type MusterReport } from './report-muster.js';

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

// ── Combined attendance (muster) sheet ──────────────────────────────────────
// The layout HR teams already keep by hand, column for column:
//   SL No | Name | Profile | Department | DOJ | Branch | 1 … 28-31 |
//   Total Present Day | Weekoff Paid | Paid Leave | Holidays | Total Paid Days | Final Paid Days
// Final Paid Days is deliberately empty: HR settles it by hand after review.

const MUSTER_HEADER_FILL = 'FFFFFF00'; // the yellow header of the paper sheet
// Same palette as STATUS_FILL above, keyed by cell code.
const MUSTER_CELL_FILL: Partial<Record<MusterCode, string>> = {
  A: 'FFFEE2E2',
  MP: 'FFFED7AA', // = STATUS_FILL.missed_punch
  HD: 'FFFEF9C3',
  'HD/L': 'FFFEF9C3',
  L: 'FFDBEAFE',
  LOP: 'FFFECACA',
  WO: 'FFF1F5F9',
  H: 'FFE2E8F0',
};

/** "Sep 2026" for "2026-09". */
function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** DD/MM/YYYY, as the paper sheet writes it. */
function dmy(date: string | null): string {
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';
}

export async function musterXlsx(report: MusterReport, scopeLabel: string): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Attendance ${report.month}`, {
    views: [{ state: 'frozen', xSplit: 6, ySplit: 2 }],
  });

  const dayNumbers = Array.from({ length: report.days_in_month }, (_, i) => i + 1);
  const headers = [
    'SL No', 'Name', 'Profile', 'Department', 'DOJ', 'Branch',
    ...dayNumbers.map(String),
    'Total Present Day', 'Weekoff Paid', 'Paid Leave', 'Holidays', 'Total Paid Days', 'Final Paid Days',
  ];
  const widths = [6, 24, 22, 16, 11, 18, ...dayNumbers.map(() => 4.5), 11, 10, 10, 9, 11, 11];
  ws.columns = widths.map((width) => ({ width }));

  const title = ws.addRow([`Combined attendance — ${monthTitle(report.month)} — ${scopeLabel}`]);
  title.font = { bold: true, size: 12 };
  ws.mergeCells(1, 1, 1, headers.length);

  const head = ws.addRow(headers);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 30;
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MUSTER_HEADER_FILL } };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  const firstDayCol = 7;
  for (const r of report.rows) {
    const row = ws.addRow([
      r.sl_no, r.name, r.designation ?? '', r.department ?? '', dmy(r.date_of_joining), r.branch,
      ...r.days,
      r.present, r.weekoff_paid, r.paid_leave, r.holidays, r.total_paid, null,
    ]);
    r.days.forEach((code, i) => {
      const cell = row.getCell(firstDayCol + i);
      cell.alignment = { horizontal: 'center' };
      const argb = MUSTER_CELL_FILL[code];
      if (argb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    });
  }
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };

  const legend = wb.addWorksheet('Legend');
  legend.columns = [{ header: 'Code', key: 'code', width: 8 }, { header: 'Meaning', key: 'meaning', width: 40 }];
  legend.getRow(1).font = { bold: true };
  for (const [code, meaning] of Object.entries(MUSTER_CODES)) legend.addRow({ code, meaning });
  legend.addRow({});
  legend.addRow({ code: 'Totals', meaning: 'Total Present Day counts a half day as 0.5.' });
  legend.addRow({ meaning: 'Total Paid Days = Present + Weekoff Paid + Paid Leave + Holidays.' });
  legend.addRow({ meaning: 'Final Paid Days is left for HR to fill in.' });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
