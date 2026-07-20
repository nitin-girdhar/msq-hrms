import { asc, and, eq } from 'drizzle-orm';
import { withTenantConfigTx } from '@crm/db';
import type { RoleTxContext } from '@crm/db';
import { leaveTypesTable } from '@crm/db/schema';

type LeaveTypeInsert = typeof leaveTypesTable.$inferInsert;
type LeaveTypeUpdate = Partial<LeaveTypeInsert>;
type LeaveTypeCreateFields = Omit<LeaveTypeInsert, 'tenantId'>;

// Tenant-scoped admin management (N-6): runs as the product-scoped login via
// withTenantConfigTx with app.current_tenant_id pinned to the super_admin-selected
// tenant, so the admin write RLS policy (db_scripts/25, keyed on
// app.current_tenant_id) physically prevents touching any other tenant's rows.
// The explicit WHERE/values tenantId below is kept as defense-in-depth.
export async function list(ctx: RoleTxContext) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, (tx) =>
    tx
      .select()
      .from(leaveTypesTable)
      .where(eq(leaveTypesTable.tenantId, ctx.tenant_id))
      .orderBy(asc(leaveTypesTable.sortOrder)),
  );
}

export async function create(ctx: RoleTxContext, fields: LeaveTypeCreateFields) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, async (tx) => {
    const [row] = await tx
      .insert(leaveTypesTable)
      .values({ ...fields, tenantId: ctx.tenant_id })
      .returning();
    return row ?? null;
  });
}

export async function update(ctx: RoleTxContext, id: string, fields: LeaveTypeUpdate) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, async (tx) => {
    const [row] = await tx
      .update(leaveTypesTable)
      .set(fields)
      .where(and(eq(leaveTypesTable.id, id), eq(leaveTypesTable.tenantId, ctx.tenant_id)))
      .returning();
    return row ?? null;
  });
}
