import { z } from 'zod';

export const createEmploymentTypeSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateEmploymentTypeSchema = createEmploymentTypeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

// tenant_id is routing/scoping context (which tenant's catalog a super_admin is
// editing), not a stored field on the entity — carried as a query param on
// every route (GET/POST/PATCH) rather than in the body schema.
export const tenantScopedQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

export type CreateEmploymentTypeInput = z.infer<typeof createEmploymentTypeSchema>;
export type UpdateEmploymentTypeInput = z.infer<typeof updateEmploymentTypeSchema>;
export type TenantScopedQuery = z.infer<typeof tenantScopedQuerySchema>;
