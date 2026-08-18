import { z } from 'zod';

export const createDesignationSchema = z.object({
  name: z.string().min(1).max(200).trim(),
});

export const updateDesignationSchema = createDesignationSchema.partial().extend({
  is_active: z.boolean().optional(),
});

// Both org_id and tenant_id arrive as query params, like every other admin
// lookup route: org_id is the row-level scope (hr.designations has no
// tenant_id column at all), tenant_id pins the RLS session (see
// db_scripts/08_rls.sql's admin_tenant_config_policy on hr.designations) and
// is what the org is checked against before any write.
export const orgScopedQuerySchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
});

export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;
export type OrgScopedQuery = z.infer<typeof orgScopedQuerySchema>;
