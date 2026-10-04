import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// A punch HR adds on someone's behalf (a forgotten check-in/out, a dead device). The moment
// is a full timestamp; the server maps it to the org-local work date.
export const manualPunchSchema = z.object({
  user_id: z.string().uuid(),
  event_type: z.enum(['check_in', 'check_out']),
  occurred_at: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
});

// Mark several people's day with one status (e.g. an outage at the gate).
export const bulkRegularizeSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(100),
  work_date: isoDate,
  status_name: z.string().min(1).max(50),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
});

export const nudgeSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(200),
  work_date: isoDate,
});

export const punchLogQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
});

export type ManualPunchInput = z.infer<typeof manualPunchSchema>;
export type BulkRegularizeInput = z.infer<typeof bulkRegularizeSchema>;
export type NudgeInput = z.infer<typeof nudgeSchema>;
export type PunchLogQueryInput = z.infer<typeof punchLogQuerySchema>;
