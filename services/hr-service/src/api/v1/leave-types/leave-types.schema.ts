import { z } from 'zod';

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  is_paid: z.boolean().default(true),
  sort_order: z.number().int().optional(),
});

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

// tenant_id is routing/scoping context (which tenant's catalog a super_admin is
// editing), not a stored field on the entity — carried as a query param on
// every route (GET/POST/PATCH) rather than in the body schema.
export const tenantScopedQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
export type TenantScopedQuery = z.infer<typeof tenantScopedQuerySchema>;
