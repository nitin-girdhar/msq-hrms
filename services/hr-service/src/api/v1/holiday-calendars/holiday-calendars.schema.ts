import { z } from 'zod';

export const createHolidayCalendarSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  year: z.number().int(),
});

export const updateHolidayCalendarSchema = createHolidayCalendarSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const orgScopedQuerySchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
});

export type CreateHolidayCalendarInput = z.infer<typeof createHolidayCalendarSchema>;
export type UpdateHolidayCalendarInput = z.infer<typeof updateHolidayCalendarSchema>;
export type OrgScopedQuery = z.infer<typeof orgScopedQuerySchema>;
