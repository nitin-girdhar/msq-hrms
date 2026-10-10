import { z } from 'zod';

// POST /internal/employees/sync — called by identity-service after it creates a
// team member, moves their home branch, or (de)activates them.
//
// tenant_id and actor_id come from identity-service's gateway-verified session,
// not from the browser; hr-service still re-checks that home_org_id belongs to
// tenant_id before writing, and RLS fences the write to that tenant.
export const syncEmployeeProfileSchema = z.object({
  user_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  home_org_id: z.string().uuid(),
  is_active: z.boolean(),
  // Used only when the profile is first created; an existing profile's joining
  // date is HR-owned (Leave Administration → Employees) and never overwritten.
  date_of_joining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').optional(),
  // Exit date, tri-state: a YYYY-MM-DD sets it, null clears it (a reactivation), absent leaves it.
  date_of_exit: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').nullable().optional(),
  // A deactivation that names no date: file today, unless HR already recorded an exit date.
  exit_if_missing: z.boolean().optional(),
  exit_reason: z.string().trim().max(100).optional(),
  actor_id: z.string().uuid(),
});
export type SyncEmployeeProfileInput = z.infer<typeof syncEmployeeProfileSchema>;
