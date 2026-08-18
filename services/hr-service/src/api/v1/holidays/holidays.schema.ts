import { z } from 'zod';

export const createHolidaySchema = z.object({
  calendar_id: z.string().uuid(),
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  name: z.string().min(1).max(200).trim(),
  is_optional: z.boolean().optional(),
});

export const updateHolidaySchema = createHolidaySchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const orgScopedQuerySchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type OrgScopedQuery = z.infer<typeof orgScopedQuerySchema>;
