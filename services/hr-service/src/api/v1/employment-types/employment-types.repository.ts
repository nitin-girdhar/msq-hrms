import { asc, and, eq } from 'drizzle-orm';
import { withTenantConfigTx } from '@platform/db';
import type { RoleTxContext } from '@platform/db';
import { employmentTypesTable } from '@platform/db/schema';

type EmploymentTypeInsert = typeof employmentTypesTable.$inferInsert;
type EmploymentTypeUpdate = Partial<EmploymentTypeInsert>;
type EmploymentTypeCreateFields = Omit<EmploymentTypeInsert, 'tenantId'>;

// Tenant-scoped admin management (N-6): runs as the product-scoped login via
// withTenantConfigTx with app.current_tenant_id pinned to the super_admin-selected
// tenant, so the admin write RLS policy (db_scripts/25, keyed on
// app.current_tenant_id) physically prevents touching any other tenant's rows.
// The explicit WHERE/values tenantId below is kept as defense-in-depth.
export async function list(ctx: RoleTxContext) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, (tx) =>
    tx
      .select()
      .from(employmentTypesTable)
      .where(eq(employmentTypesTable.tenantId, ctx.tenant_id))
      .orderBy(asc(employmentTypesTable.label)),
  );
}

export async function create(ctx: RoleTxContext, fields: EmploymentTypeCreateFields) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, async (tx) => {
    const [row] = await tx
      .insert(employmentTypesTable)
      .values({ ...fields, tenantId: ctx.tenant_id })
      .returning();
    return row ?? null;
  });
}

export async function update(ctx: RoleTxContext, id: string, fields: EmploymentTypeUpdate) {
  return withTenantConfigTx({ actorUserId: ctx.user_id, tenantId: ctx.tenant_id }, async (tx) => {
    const [row] = await tx
      .update(employmentTypesTable)
      .set(fields)
      .where(and(eq(employmentTypesTable.id, id), eq(employmentTypesTable.tenantId, ctx.tenant_id)))
      .returning();
    return row ?? null;
  });
}
