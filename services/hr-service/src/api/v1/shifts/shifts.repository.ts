import { asc, and, eq } from 'drizzle-orm';
import { withTenantConfigTx } from '@platform/db';
import { shiftsTable, organizationsTable } from '@platform/db/schema';

type ShiftInsert = typeof shiftsTable.$inferInsert;
type ShiftUpdate = Partial<ShiftInsert>;

export interface OrgCtx {
  tenantId: string;
  orgId: string;
  actorUserId: string;
}

export async function list(ctx: OrgCtx) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, (tx) =>
    tx
      .select()
      .from(shiftsTable)
      .where(and(eq(shiftsTable.orgId, ctx.orgId), eq(shiftsTable.isDeleted, false)))
      .orderBy(asc(shiftsTable.name)),
  );
}

export async function getById(ctx: OrgCtx, id: string) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(shiftsTable)
      .where(and(eq(shiftsTable.id, id), eq(shiftsTable.orgId, ctx.orgId)));
    return row ?? null;
  });
}

export async function orgBelongsToTenant(ctx: OrgCtx) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(and(eq(organizationsTable.id, ctx.orgId), eq(organizationsTable.tenantId, ctx.tenantId)));
    return row !== undefined;
  });
}

export async function create(ctx: OrgCtx, fields: Omit<ShiftInsert, 'orgId'>) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx.insert(shiftsTable).values({ ...fields, orgId: ctx.orgId }).returning();
    return row;
  });
}

export async function update(ctx: OrgCtx, id: string, fields: ShiftUpdate) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .update(shiftsTable)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(shiftsTable.id, id), eq(shiftsTable.orgId, ctx.orgId)))
      .returning();
    return row ?? null;
  });
}
