// Payslip shapes (schema 1.62.0). snake_case, matching the API.

export interface PayslipSummary {
  id: string;
  /** First day of the pay month, YYYY-MM-01. */
  period: string;
  working_days: number | null;
  lop_days: number | null;
  gross: number;
  deductions: number;
  net: number;
  published_at: string | null;
}

export interface PayslipLine {
  kind: 'earning' | 'deduction';
  label: string;
  amount: number;
}

export interface PayslipDetail extends PayslipSummary {
  user_full_name: string;
  employee_code: string | null;
  lines: PayslipLine[];
}

export interface PayrollOverview {
  month: string;
  status: 'open' | 'locked';
  locked_at: string | null;
  payslips: Array<PayslipSummary & { user_id: string; user_full_name: string }>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-04-01' → 'Apr 2026'. */
export function formatMonth(isoDate: string): string {
  return `${MONTHS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}`;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
}
