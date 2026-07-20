import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const halfDay = z.enum(['full', 'first_half', 'second_half']);
const accrualFrequency = z.enum(['monthly', 'quarterly', 'yearly', 'none']);

// ── Leave requests ──────────────────────────────────────────────────────────

export const applyLeaveRequestSchema = z.object({
  leave_type_name: z.string().min(1),
  start_date: isoDate,
  end_date: isoDate,
  start_half: halfDay.default('full'),
  end_half: halfDay.default('full'),
  reason: z.string().max(1000).optional(),
  document_url: z.string().url().max(2000).optional(),
});

// Read-only working-days preview for the apply form. Same inputs as apply
// (minus reason/document) — reuses computeLeaveDays and the apply validations
// but commits nothing and returns warnings instead of throwing.
export const previewLeaveRequestSchema = z.object({
  leave_type_name: z.string().min(1),
  start_date: isoDate,
  end_date: isoDate,
  start_half: halfDay.default('full'),
  end_half: halfDay.default('full'),
});

export const listLeaveRequestsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().max(50).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const approveLeaveRequestSchema = z.object({
  comment: z.string().max(1000).optional(),
});

export const rejectLeaveRequestSchema = z.object({
  comment: z.string().min(1, 'A comment is required when rejecting').max(1000),
});

export const cancelLeaveRequestSchema = z.object({
  comment: z.string().max(1000).optional(),
});

// ── Balances & ledger ───────────────────────────────────────────────────────

export const listLedgerSchema = z.object({
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createAdjustmentSchema = z.object({
  user_id: z.string().uuid(),
  leave_type_name: z.string().min(1),
  amount: z.coerce.number().refine((n) => n !== 0, 'Amount must be non-zero'),
  note: z.string().min(1, 'A note is required for manual adjustments').max(1000),
  effective_date: isoDate.optional(),
});

// ── Policies ────────────────────────────────────────────────────────────────

export const listPoliciesSchema = z.object({
  leave_type_name: z.string().optional(),
});

export const createPolicySchema = z.object({
  leave_type_name: z.string().min(1),
  // null / omitted org_id ⇒ tenant-wide policy (tenant_admin only)
  org_id: z.string().uuid().nullable().optional(),
  accrual_frequency: accrualFrequency.default('none'),
  accrual_amount: z.coerce.number().min(0).default(0),
  max_balance: z.coerce.number().min(0).nullable().optional(),
  carry_forward: z.boolean().default(false),
  max_carry_forward: z.coerce.number().min(0).nullable().optional(),
  max_consecutive_days: z.coerce.number().int().positive().nullable().optional(),
  min_notice_days: z.coerce.number().int().min(0).default(0),
  allow_half_day: z.boolean().default(true),
  requires_document_after_days: z.coerce.number().int().positive().nullable().optional(),
  approval_levels: z.coerce.number().int().min(1).default(1),
  applicable_from: isoDate,
});

export const updatePolicySchema = z.object({
  accrual_frequency: accrualFrequency.optional(),
  accrual_amount: z.coerce.number().min(0).optional(),
  max_balance: z.coerce.number().min(0).nullable().optional(),
  carry_forward: z.boolean().optional(),
  max_carry_forward: z.coerce.number().min(0).nullable().optional(),
  max_consecutive_days: z.coerce.number().int().positive().nullable().optional(),
  min_notice_days: z.coerce.number().int().min(0).optional(),
  allow_half_day: z.boolean().optional(),
  requires_document_after_days: z.coerce.number().int().positive().nullable().optional(),
  approval_levels: z.coerce.number().int().min(1).optional(),
  is_active: z.boolean().optional(),
});

// ── Holidays & calendars ──────────────────────────────────────────────────────

export const listHolidaysSchema = z.object({
  year: z.coerce.number().int().optional(),
  calendar_id: z.string().uuid().optional(),
});

export const createHolidaySchema = z.object({
  calendar_id: z.string().uuid(),
  holiday_date: isoDate,
  name: z.string().min(1).max(200),
  is_optional: z.boolean().default(false),
});

export const updateHolidaySchema = z.object({
  holiday_date: isoDate.optional(),
  name: z.string().min(1).max(200).optional(),
  is_optional: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export const createHolidayCalendarSchema = z.object({
  name: z.string().min(1).max(200),
  year: z.coerce.number().int(),
});

export const updateHolidayCalendarSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  year: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
});

// ── Settings ──────────────────────────────────────────────────────────────────

export const updateLeaveSettingsSchema = z.object({
  leave_cycle_start_month: z.coerce.number().int().min(1).max(12),
  // 'org' writes/overrides the org row; 'tenant' writes the tenant-wide row.
  scope: z.enum(['org', 'tenant']).default('org'),
});

export type ApplyLeaveRequestInput = z.infer<typeof applyLeaveRequestSchema>;
export type PreviewLeaveRequestInput = z.infer<typeof previewLeaveRequestSchema>;
export type ListLeaveRequestsInput = z.infer<typeof listLeaveRequestsSchema>;
export type ApproveLeaveRequestInput = z.infer<typeof approveLeaveRequestSchema>;
export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>;
export type CancelLeaveRequestInput = z.infer<typeof cancelLeaveRequestSchema>;
export type ListLedgerInput = z.infer<typeof listLedgerSchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type ListPoliciesInput = z.infer<typeof listPoliciesSchema>;
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type ListHolidaysInput = z.infer<typeof listHolidaysSchema>;
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type CreateHolidayCalendarInput = z.infer<typeof createHolidayCalendarSchema>;
export type UpdateHolidayCalendarInput = z.infer<typeof updateHolidayCalendarSchema>;
export type UpdateLeaveSettingsInput = z.infer<typeof updateLeaveSettingsSchema>;
