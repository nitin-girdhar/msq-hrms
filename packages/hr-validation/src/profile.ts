import { z } from 'zod';

// ── Employee 360 / My profile (schema 1.60.0) ───────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// Empty string clears a field, so a form can send what it holds without
// special-casing blanks. null/undefined are treated the same way server-side.
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const GENDERS = ['female', 'male', 'other', 'undisclosed'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'undisclosed'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const NOTE_KINDS = ['note', 'appraisal', 'promotion', 'transfer', 'warning', 'other'] as const;

/**
 * The whole personal-details form, sent back as loaded (changed or not), so the
 * server can replace the row without a field-by-field patch protocol. An empty
 * string means "clear this field".
 */
export const upsertPersonalSchema = z.object({
  preferred_name: optionalText(100),
  date_of_birth: z.union([isoDate, z.literal('')]).optional(),
  gender: z.union([z.enum(GENDERS), z.literal('')]).optional(),
  marital_status: z.union([z.enum(MARITAL_STATUSES), z.literal('')]).optional(),
  blood_group: z.union([z.enum(BLOOD_GROUPS), z.literal('')]).optional(),
  nationality: optionalText(100),
  personal_email: z.union([z.string().trim().email().max(254), z.literal('')]).optional(),
  current_address: optionalText(500),
  permanent_address: optionalText(500),
});

export const createEmergencyContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  relation: z.string().trim().min(1, 'Relation is required').max(50),
  phone: z.string().trim().min(5, 'Phone is required').max(20),
  is_primary: z.boolean().default(false),
});

export const updateEmergencyContactSchema = createEmergencyContactSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nothing to update' },
);

export const createEmployeeNoteSchema = z.object({
  kind: z.enum(NOTE_KINDS).default('note'),
  body: z.string().trim().min(1, 'A note cannot be empty').max(2000),
});

export type UpsertPersonalInput = z.infer<typeof upsertPersonalSchema>;
export type CreateEmergencyContactInput = z.infer<typeof createEmergencyContactSchema>;
export type UpdateEmergencyContactInput = z.infer<typeof updateEmergencyContactSchema>;
export type CreateEmployeeNoteInput = z.infer<typeof createEmployeeNoteSchema>;
