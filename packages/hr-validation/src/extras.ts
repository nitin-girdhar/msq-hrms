import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// ── Announcements (schema 1.63.0) ───────────────────────────────────────────
export const ANNOUNCEMENT_CATEGORIES = ['general', 'policy', 'event', 'celebration'] as const;

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(150),
  body: z.string().trim().min(1, 'Write the announcement').max(4000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default('general'),
  is_pinned: z.boolean().default(false),
  expires_on: isoDate.optional(),
  // true = visible to the branch straight away; false = save as a draft.
  publish: z.boolean().default(true),
});

// ── Assets ───────────────────────────────────────────────────────────────────
export const ASSET_CATEGORIES = ['laptop', 'monitor', 'phone', 'access_card', 'other'] as const;

export const createAssetSchema = z.object({
  asset_tag: z.string().trim().min(1, 'An asset tag is required').max(50),
  name: z.string().trim().min(1, 'A name is required').max(150),
  category: z.enum(ASSET_CATEGORIES).default('other'),
  serial_no: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const assignAssetSchema = z.object({
  user_id: z.string().uuid(),
  note: z.string().trim().max(300).optional(),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;

// ── Documents vault (schema 1.65.0) ─────────────────────────────────────────
export const DOCUMENT_CATEGORIES = ['id_proof', 'address_proof', 'education', 'employment', 'tax_proof', 'medical', 'other'] as const;
/** Largest file, in bytes. The CHECK on hr.employee_documents.size_bytes says the same. */
export const DOCUMENT_MAX_BYTES = 3_670_016; // 3.5 MiB: its base64 (~4.9 MB) still fits the 5 MB request body
/** What HR gets until they set their own limit. */
export const DOCUMENT_DEFAULT_BYTES = 3 * 1024 * 1024;
export const DOCUMENT_MIN_BYTES = 100 * 1024;

export const uploadDocumentSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().min(1, 'Give the document a title').max(150),
  file_name: z.string().trim().min(1).max(200),
  // The file itself, base64. 3 MiB of bytes is ~4.2 MB of base64, inside the 5 MB body limit.
  data_base64: z.string().min(8, 'Choose a file').max(Math.ceil((DOCUMENT_MAX_BYTES * 4) / 3) + 8),
  expires_on: isoDate.optional(),
  tax_section: z.string().trim().max(30).optional(),
  amount: z.number().min(0).max(1_000_000_000).optional(),
});

export const reviewDocumentSchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === 'verified' || (v.note ?? '').length > 0, { message: 'Say why it was rejected', path: ['note'] });

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;

// ── Document upload limit (schema 1.66.0) ───────────────────────────────────
export const documentSettingsSchema = z.object({
  max_bytes: z.number().int().min(DOCUMENT_MIN_BYTES, 'The limit cannot be below 100 KB').max(DOCUMENT_MAX_BYTES, 'The limit cannot be above 3.5 MB'),
});
export type DocumentSettingsInput = z.infer<typeof documentSettingsSchema>;

// ── Roster planner (schema 1.66.0) ──────────────────────────────────────────
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const plannerWeekQuerySchema = z.object({
  from: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  department_id: z.string().uuid().optional(),
});

/** Make `shift_id` (or no shift, when null) the shift of every listed person for [from, to]. */
export const applyShiftsSchema = z
  .object({
    user_ids: z.array(z.string().uuid()).min(1, 'Pick at least one person').max(200),
    from: isoDate,
    to: isoDate,
    shift_id: z.string().uuid().nullable(),
  })
  .refine((v) => v.to >= v.from, { message: 'The end date is before the start date', path: ['to'] })
  .refine((v) => daysBetween(v.from, v.to) <= 92, { message: 'Plan at most three months at a time', path: ['to'] });

export const setRequirementSchema = z.object({
  shift_id: z.string().uuid(),
  required_headcount: z.number().int().min(0).max(5000),
});

export const publishRosterSchema = z.object({
  week_start: isoDate,
  note: z.string().trim().max(300).optional(),
});

export type PlannerWeekQuery = z.infer<typeof plannerWeekQuerySchema>;
export type ApplyShiftsInput = z.infer<typeof applyShiftsSchema>;
export type SetRequirementInput = z.infer<typeof setRequirementSchema>;
export type PublishRosterInput = z.infer<typeof publishRosterSchema>;
