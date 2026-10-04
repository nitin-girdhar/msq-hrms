import { z } from 'zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

export const payslipLineSchema = z.object({
  kind: z.enum(['earning', 'deduction']),
  label: z.string().trim().min(1).max(100),
  amount: z.number().min(0).max(100_000_000),
});

// Prepare (or replace) one employee's DRAFT payslip. Totals are computed server-side.
export const upsertPayslipSchema = z.object({
  user_id: z.string().uuid(),
  month,
  working_days: z.number().min(0).max(31).optional(),
  lop_days: z.number().min(0).max(31).optional(),
  lines: z.array(payslipLineSchema).min(1, 'Add at least one line').max(40),
});

export const payrollMonthQuerySchema = z.object({ month });

export type PayslipLineInput = z.infer<typeof payslipLineSchema>;
export type UpsertPayslipInput = z.infer<typeof upsertPayslipSchema>;
export type PayrollMonthQueryInput = z.infer<typeof payrollMonthQuerySchema>;
