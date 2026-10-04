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
  // Apply page (schema 1.67.0): the colleague covering the work, and a file uploaded through
  // POST /leave/attachments (the token it returned, plus the name to show).
  handover_user_id: z.string().uuid().nullable().optional(),
  attachment_token: z.string().max(300).nullable().optional(),
  attachment_name: z.string().trim().max(200).nullable().optional(),
});

// Amending a request that is still pending. The full set is required, not a
// partial patch: every rule the server re-checks (working days, balance,
// consecutive-day cap, document requirement) is a function of the WHOLE request,
// so a half-specified edit could not be validated coherently. The apply form
// sends back what it loaded, changed or not.
export const updateLeaveRequestSchema = z.object({
  leave_type_name: z.string().min(1),
  start_date: isoDate,
  end_date: isoDate,
  start_half: halfDay.default('full'),
  end_half: halfDay.default('full'),
  reason: z.string().max(1000).optional(),
  document_url: z.string().url().max(2000).optional(),
  handover_user_id: z.string().uuid().nullable().optional(),
  attachment_token: z.string().max(300).nullable().optional(),
  attachment_name: z.string().trim().max(200).nullable().optional(),
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

// One decision applied to many pending requests (approvals queue "select all").
// Capped well under a page of the queue so a single call stays bounded; each
// request still runs through the single-request path, so this adds no authority.
export const bulkLeaveDecisionSchema = z
  .object({
    request_ids: z.array(z.string().uuid()).min(1).max(100),
    decision: z.enum(['approve', 'reject']),
    comment: z.string().max(1000).optional(),
  })
  .refine((v) => v.decision !== 'reject' || (v.comment ?? '').trim().length > 0, {
    message: 'A comment is required when rejecting',
    path: ['comment'],
  });

// Claim a day off for work done on a day off. Whole or half day only. Whether the
// date qualifies (a weekly off or holiday, not future, within the backdate
// window) is decided server-side against the claimant's own roster.
export const createCompOffClaimSchema = z.object({
  worked_date: isoDate,
  days: z.union([z.literal(0.5), z.literal(1)]),
  reason: z.string().trim().min(1, 'Say what you worked on').max(500),
});

export const listCompOffQueueSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).default('pending'),
});

export const decideCompOffSchema = z.object({
  comment: z.string().trim().max(1000).optional(),
});

export const rejectCompOffSchema = z.object({
  comment: z.string().trim().min(1, 'A comment is required when rejecting').max(1000),
});

// The approver's question to the requester (the request stays pending).
export const requestLeaveInfoSchema = z.object({
  comment: z.string().trim().min(1, 'Say what you need to know').max(1000),
});

// Cash out unused days of a leave type whose policy allows it.
export const createEncashmentSchema = z.object({
  leave_type_name: z.string().min(1),
  days: z.number().positive().max(365),
  reason: z.string().trim().max(500).optional(),
});

export const cancelLeaveRequestSchema = z.object({
  comment: z.string().max(1000).optional(),
});

// ── Balances & ledger ───────────────────────────────────────────────────────

// Balance per leave type "as on" a date. as_of drives which leave POLICY is
// effective (see resolveEffectivePolicy); it bounds the ledger sum only when
// the caller passes it explicitly — see listOwnBalances for why.
export const listBalancesSchema = z.object({
  as_of: isoDate.optional(),
});

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
  // 1.64.0: approval window shown as a countdown, and cash-out rules.
  sla_hours: z.coerce.number().int().min(1).max(720).default(48),
  encashable: z.boolean().default(false),
  max_encash_days: z.coerce.number().positive().max(365).nullable().optional(),
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
  sla_hours: z.coerce.number().int().min(1).max(720).optional(),
  encashable: z.boolean().optional(),
  max_encash_days: z.coerce.number().positive().max(365).nullable().optional(),
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
export type UpdateLeaveRequestInput = z.infer<typeof updateLeaveRequestSchema>;
export type PreviewLeaveRequestInput = z.infer<typeof previewLeaveRequestSchema>;
export type ListLeaveRequestsInput = z.infer<typeof listLeaveRequestsSchema>;
export type ApproveLeaveRequestInput = z.infer<typeof approveLeaveRequestSchema>;
export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>;
export type CreateCompOffClaimInput = z.infer<typeof createCompOffClaimSchema>;
export type ListCompOffQueueInput = z.infer<typeof listCompOffQueueSchema>;
export type DecideCompOffInput = z.infer<typeof decideCompOffSchema>;
export type RejectCompOffInput = z.infer<typeof rejectCompOffSchema>;
export type BulkLeaveDecisionInput = z.infer<typeof bulkLeaveDecisionSchema>;
export type RequestLeaveInfoInput = z.infer<typeof requestLeaveInfoSchema>;
export type CreateEncashmentInput = z.infer<typeof createEncashmentSchema>;
export type CancelLeaveRequestInput = z.infer<typeof cancelLeaveRequestSchema>;
export type ListBalancesInput = z.infer<typeof listBalancesSchema>;
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

/** Upload a supporting document for a leave request; the returned token goes on the request. */
export const uploadLeaveAttachmentSchema = z.object({
  file_name: z.string().trim().min(1).max(200),
  // Base64 of at most 3.5 MiB (see DOCUMENT_MAX_BYTES), inside the 5 MB request body.
  data_base64: z.string().min(8).max(4_893_363 + 16),
});
export type UploadLeaveAttachmentInput = z.infer<typeof uploadLeaveAttachmentSchema>;
