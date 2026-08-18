import { asc, and, eq } from 'drizzle-orm';
import { withTenantConfigTx } from '@platform/db';
import type { RoleTxContext } from '@platform/db';
import { leaveRequestStatusesTable } from '@platform/db/schema';

type LeaveRequestStatusInsert = typeof leaveRequestStatusesTable.$inferInsert;
type LeaveRequestStatusUpdate = Partial<LeaveRequestStatusInsert>;
type LeaveRequestStatusCreateFields = Omit<LeaveRequestStatusInsert, 'tenantId'>;

// Tenant-scoped admin management, mirroring the three sibling HR lookups: runs
// as the product-scoped login via withTenantConfigTx with app.current_tenant_id
// pinned to the super_admin-selected tenant, so the admin write RLS policy
// physically prevents touching another tenant's rows. The explicit
// WHERE/values tenantId below is kept as defense-in-depth.
export async function list(ctx: RoleTxContext) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, (tx) =>
    tx
      .select()
      .from(leaveRequestStatusesTable)
      .where(eq(leaveRequestStatusesTable.tenantId, ctx.tenant_id))
      .orderBy(asc(leaveRequestStatusesTable.label)),
  );
}

// Needed by the service's reserved-name guard: the frozen vocabulary is keyed
// on the row's CURRENT name, which a PATCH body may be trying to replace.
export async function getById(ctx: RoleTxContext, id: string) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, async (tx) => {
    const [row] = await tx
      .select()
      .from(leaveRequestStatusesTable)
      .where(and(eq(leaveRequestStatusesTable.id, id), eq(leaveRequestStatusesTable.tenantId, ctx.tenant_id)));
    return row ?? null;
  });
}

export async function create(ctx: RoleTxContext, fields: LeaveRequestStatusCreateFields) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, async (tx) => {
    const [row] = await tx
      .insert(leaveRequestStatusesTable)
      .values({ ...fields, tenantId: ctx.tenant_id })
      .returning();
    return row ?? null;
  });
}

export async function update(ctx: RoleTxContext, id: string, fields: LeaveRequestStatusUpdate) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, async (tx) => {
    const [row] = await tx
      .update(leaveRequestStatusesTable)
      .set(fields)
      .where(and(eq(leaveRequestStatusesTable.id, id), eq(leaveRequestStatusesTable.tenantId, ctx.tenant_id)))
      .returning();
    return row ?? null;
  });
}
