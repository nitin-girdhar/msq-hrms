import { z } from 'zod';

const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM or HH:MM:SS');

export const createShiftSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  start_time: timeSchema,
  end_time: timeSchema,
  grace_minutes: z.number().int().min(0).optional(),
  min_half_day_minutes: z.number().int().min(0).optional(),
  min_full_day_minutes: z.number().int().min(0).optional(),
  is_night_shift: z.boolean().optional(),
  is_split: z.boolean().optional(),
  // null = follow the attendance policy; 0 = no rest rule for this shift.
  min_rest_hours: z.number().int().min(0).max(24).nullable().optional(),
});

export const updateShiftSchema = createShiftSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const orgScopedQuerySchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type OrgScopedQuery = z.infer<typeof orgScopedQuerySchema>;
