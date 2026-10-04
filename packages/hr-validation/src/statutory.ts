import { z } from 'zod';

// Statutory + bank details (schema 1.64.0). Stored as PLAIN TEXT for now by product
// decision (encryption comes later). The formats below mirror the table's CHECKs, so a
// bad value fails here with a readable message instead of as a database error.
//
// Every field is optional and '' means "clear it". PAN and IFSC are upper-cased first so
// a lower-case paste still validates.
const upper = (s: unknown) => (typeof s === 'string' ? s.trim().toUpperCase() : s);
const digits = (s: unknown) => (typeof s === 'string' ? s.replace(/[\s-]/g, '') : s);
const blank = z.literal('');

export const STATUTORY_FIELDS = [
  'pan', 'aadhaar', 'uan', 'bank_name', 'bank_branch', 'account_number', 'ifsc', 'account_type', 'tax_regime',
] as const;

export const statutoryFieldsSchema = z.object({
  pan: z.preprocess(upper, z.union([z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like ABCDE1234F'), blank])).optional(),
  aadhaar: z.preprocess(digits, z.union([z.string().regex(/^[0-9]{12}$/, 'Aadhaar is 12 digits'), blank])).optional(),
  uan: z.preprocess(digits, z.union([z.string().regex(/^[0-9]{12}$/, 'UAN is 12 digits'), blank])).optional(),
  bank_name: z.string().trim().max(100).optional(),
  bank_branch: z.string().trim().max(100).optional(),
  account_number: z.preprocess(digits, z.union([z.string().regex(/^[0-9]{6,20}$/, 'Account number is 6 to 20 digits'), blank])).optional(),
  ifsc: z.preprocess(upper, z.union([z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like HDFC0001234'), blank])).optional(),
  account_type: z.union([z.enum(['savings', 'current']), blank]).optional(),
  tax_regime: z.union([z.enum(['old', 'new']), blank]).optional(),
});

// An employee asks HR to change their details; HR applies the payload on approval.
export const createChangeRequestSchema = z.object({
  payload: statutoryFieldsSchema.refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Change at least one field' }),
  reason: z.string().trim().max(500).optional(),
});

export const listChangeRequestsSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).default('pending'),
});

export const decideChangeRequestSchema = z.object({
  comment: z.string().trim().max(1000).optional(),
});
export const rejectChangeRequestSchema = z.object({
  comment: z.string().trim().min(1, 'A comment is required when rejecting').max(1000),
});

export const employeeMonthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
});

export type StatutoryFieldsInput = z.infer<typeof statutoryFieldsSchema>;
export type CreateChangeRequestInput = z.infer<typeof createChangeRequestSchema>;
export type ListChangeRequestsInput = z.infer<typeof listChangeRequestsSchema>;
export type DecideChangeRequestInput = z.infer<typeof decideChangeRequestSchema>;
export type RejectChangeRequestInput = z.infer<typeof rejectChangeRequestSchema>;
export type EmployeeMonthQueryInput = z.infer<typeof employeeMonthQuerySchema>;
