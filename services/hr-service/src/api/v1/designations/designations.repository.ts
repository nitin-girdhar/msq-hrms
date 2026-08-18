import { asc, and, eq } from 'drizzle-orm';
import { withTenantConfigTx } from '@platform/db';
import { designationsTable, organizationsTable } from '@platform/db/schema';

type DesignationInsert = typeof designationsTable.$inferInsert;
type DesignationUpdate = Partial<DesignationInsert>;

export interface DesignationCtx {
  tenantId: string;
  orgId: string;
  actorUserId: string;
}

// hr.designations is org-scoped, not tenant-scoped — there is no tenant_id
// column to filter list() on the way every other admin lookup repository
// does. withTenantConfigTx still pins app.current_tenant_id (required by
// admin_tenant_config_policy, db_scripts/08_rls.sql), and every query below
// additionally filters on the SPECIFIC org_id the admin selected — the RLS
// policy alone only narrows to "some org under this tenant".
export async function list(ctx: DesignationCtx) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, (tx) =>
    tx
      .select()
      .from(designationsTable)
      .where(and(eq(designationsTable.orgId, ctx.orgId), eq(designationsTable.isDeleted, false)))
      .orderBy(asc(designationsTable.name)),
  );
}

export async function getById(ctx: DesignationCtx, id: string) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(designationsTable)
      .where(and(eq(designationsTable.id, id), eq(designationsTable.orgId, ctx.orgId)));
    return row ?? null;
  });
}

// Same check departments.service.ts runs before a write there: the FK alone
// only requires the org to exist, not that it belongs to the tenant pinned in
// this request — and withTenantConfigTx's RLS narrows to "any org in this
// tenant", so a mismatched (org_id, tenant_id) pair from a hand-crafted
// request would otherwise write into a different tenant's org silently.
export async function orgBelongsToTenant(ctx: DesignationCtx) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(and(eq(organizationsTable.id, ctx.orgId), eq(organizationsTable.tenantId, ctx.tenantId)));
    return row !== undefined;
  });
}

export async function create(ctx: DesignationCtx, fields: Omit<DesignationInsert, 'orgId'>) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx.insert(designationsTable).values({ ...fields, orgId: ctx.orgId }).returning();
    return row;
  });
}

export async function update(ctx: DesignationCtx, id: string, fields: DesignationUpdate) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .update(designationsTable)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(designationsTable.id, id), eq(designationsTable.orgId, ctx.orgId)))
      .returning();
    return row ?? null;
  });
}
