import type { PayslipDetail } from './types';
import { formatMonth, formatMoney } from './types';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Opens a clean, self-contained payslip in a new window and hands it to the browser's print dialog, which
 * can save it as a PDF. It is a document, not part of the app, so it carries its own plain styling (no
 * tenant theme: a payslip prints the same everywhere) and none of the app chrome around it.
 */
export function printPayslip(slip: PayslipDetail, company?: string): boolean {
  const rows = (kind: 'earning' | 'deduction') =>
    slip.lines.filter((l) => l.kind === kind).map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${esc(formatMoney(l.amount))}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payslip ${esc(formatMonth(slip.period))} - ${esc(slip.user_full_name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: black; margin: 32px auto; max-width: 720px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: rgb(90, 90, 90); }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid black; padding-bottom: 10px; margin-bottom: 14px; }
  dl { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; margin: 0 0 16px; }
  dt { color: rgb(90, 90, 90); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  dd { margin: 0 0 6px; font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: rgb(90, 90, 90); border-bottom: 1px solid rgb(180, 180, 180); padding: 6px 0; }
  td { padding: 5px 0; border-bottom: 1px solid rgb(225, 225, 225); }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 1px solid black; border-bottom: none; }
  .net { margin-top: 18px; display: flex; justify-content: space-between; padding: 12px 14px; border: 2px solid black; font-size: 16px; font-weight: 700; }
  .foot { margin-top: 24px; font-size: 11px; color: rgb(90, 90, 90); }
  @media print { body { margin: 12mm; } }
</style></head><body>
<div class="head"><div><h1>Payslip</h1><div class="muted">${esc(formatMonth(slip.period))}${company ? ` · ${esc(company)}` : ''}</div></div><div class="muted">${slip.published_at ? `Published ${esc(slip.published_at.slice(0, 10))}` : ''}</div></div>
<dl>
  <div><dt>Employee</dt><dd>${esc(slip.user_full_name)}</dd></div>
  <div><dt>Employee code</dt><dd>${esc(slip.employee_code ?? '-')}</dd></div>
  <div><dt>Working days</dt><dd>${slip.working_days ?? '-'}</dd></div>
  <div><dt>Loss of pay days</dt><dd>${slip.lop_days ?? 0}</dd></div>
</dl>
<div class="cols">
  <table><thead><tr><th>Earnings</th><th class="n">Amount</th></tr></thead><tbody>${rows('earning')}</tbody><tfoot><tr><td>Gross</td><td class="n">${esc(formatMoney(slip.gross))}</td></tr></tfoot></table>
  <table><thead><tr><th>Deductions</th><th class="n">Amount</th></tr></thead><tbody>${rows('deduction')}</tbody><tfoot><tr><td>Total deductions</td><td class="n">${esc(formatMoney(slip.deductions))}</td></tr></tfoot></table>
</div>
<div class="net"><span>Net pay</span><span>${esc(formatMoney(slip.net))}</span></div>
<p class="foot">This is a system-generated payslip.</p>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false; // pop-up blocked
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
