import { asc, and, eq } from 'drizzle-orm';
import { withTenantConfigTx } from '@platform/db';
import { holidayCalendarsTable, organizationsTable } from '@platform/db/schema';

type HolidayCalendarInsert = typeof holidayCalendarsTable.$inferInsert;
type HolidayCalendarUpdate = Partial<HolidayCalendarInsert>;

export interface OrgCtx {
  tenantId: string;
  orgId: string;
  actorUserId: string;
}

export async function list(ctx: OrgCtx) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, (tx) =>
    tx
      .select()
      .from(holidayCalendarsTable)
      .where(and(eq(holidayCalendarsTable.orgId, ctx.orgId), eq(holidayCalendarsTable.isDeleted, false)))
      .orderBy(asc(holidayCalendarsTable.year), asc(holidayCalendarsTable.name)),
  );
}

export async function getById(ctx: OrgCtx, id: string) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(holidayCalendarsTable)
      .where(and(eq(holidayCalendarsTable.id, id), eq(holidayCalendarsTable.orgId, ctx.orgId)));
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

export async function create(ctx: OrgCtx, fields: Omit<HolidayCalendarInsert, 'orgId'>) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx.insert(holidayCalendarsTable).values({ ...fields, orgId: ctx.orgId }).returning();
    return row;
  });
}

export async function update(ctx: OrgCtx, id: string, fields: HolidayCalendarUpdate) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .update(holidayCalendarsTable)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(holidayCalendarsTable.id, id), eq(holidayCalendarsTable.orgId, ctx.orgId)))
      .returning();
    return row ?? null;
  });
}
