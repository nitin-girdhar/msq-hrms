import { asc, and, eq } from 'drizzle-orm';
import { withTenantConfigTx } from '@platform/db';
import { holidaysTable, holidayCalendarsTable, organizationsTable } from '@platform/db/schema';

type HolidayInsert = typeof holidaysTable.$inferInsert;
type HolidayUpdate = Partial<HolidayInsert>;

export interface OrgCtx {
  tenantId: string;
  orgId: string;
  actorUserId: string;
}

export async function list(ctx: OrgCtx) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, (tx) =>
    tx
      .select()
      .from(holidaysTable)
      .where(and(eq(holidaysTable.orgId, ctx.orgId), eq(holidaysTable.isDeleted, false)))
      .orderBy(asc(holidaysTable.holidayDate)),
  );
}

export async function getById(ctx: OrgCtx, id: string) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(holidaysTable)
      .where(and(eq(holidaysTable.id, id), eq(holidaysTable.orgId, ctx.orgId)));
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

// hr.holidays.calendar_id is a plain FK to hr.holiday_calendars(id), not a
// composite (org_id, calendar_id) one — the DB only guarantees the calendar
// exists, not that it belongs to THIS org. Checked here the same way
// departments.service.ts checks org_id against tenant_id.
export async function calendarBelongsToOrg(ctx: OrgCtx, calendarId: string) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .select({ id: holidayCalendarsTable.id })
      .from(holidayCalendarsTable)
      .where(and(eq(holidayCalendarsTable.id, calendarId), eq(holidayCalendarsTable.orgId, ctx.orgId)));
    return row !== undefined;
  });
}

export async function create(ctx: OrgCtx, fields: Omit<HolidayInsert, 'orgId'>) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx.insert(holidaysTable).values({ ...fields, orgId: ctx.orgId }).returning();
    return row;
  });
}

export async function update(ctx: OrgCtx, id: string, fields: HolidayUpdate) {
  return withTenantConfigTx({ actorUserId: ctx.actorUserId, tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx
      .update(holidaysTable)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(holidaysTable.id, id), eq(holidaysTable.orgId, ctx.orgId)))
      .returning();
    return row ?? null;
  });
}
