import { toApiRow, toApiRows } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './holidays.repository.js';
import type { OrgCtx } from './holidays.repository.js';
import type { CreateHolidayInput, UpdateHolidayInput } from './holidays.schema.js';

async function assertOrgInTenant(ctx: OrgCtx): Promise<void> {
  if (!(await repo.orgBelongsToTenant(ctx))) {
    throw new BadRequestError('That organization does not belong to this tenant.');
  }
}

async function assertCalendarInOrg(ctx: OrgCtx, calendarId: string | undefined): Promise<void> {
  if (calendarId === undefined) return;
  if (!(await repo.calendarBelongsToOrg(ctx, calendarId))) {
    throw new BadRequestError('That holiday calendar does not belong to this organization.');
  }
}

function asConflict(err: unknown): Error {
  const msg = (err as Error).message ?? '';
  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return new ConflictError('A holiday already exists on this date for this calendar.');
  }
  return err as Error;
}

export async function list(ctx: OrgCtx) {
  await assertOrgInTenant(ctx);
  return toApiRows(await repo.list(ctx));
}

export async function create(ctx: OrgCtx, data: CreateHolidayInput) {
  await assertOrgInTenant(ctx);
  await assertCalendarInOrg(ctx, data.calendar_id);

  try {
    const row = await repo.create(ctx, {
      calendarId: data.calendar_id,
      holidayDate: data.holiday_date,
      name: data.name,
      ...(data.is_optional !== undefined ? { isOptional: data.is_optional } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    throw asConflict(err);
  }
}

export async function update(ctx: OrgCtx, id: string, data: UpdateHolidayInput) {
  await assertOrgInTenant(ctx);
  await assertCalendarInOrg(ctx, data.calendar_id);

  const existing = await repo.getById(ctx, id);
  if (!existing || existing.isDeleted) throw new NotFoundError('Holiday not found');

  const fields: Parameters<typeof repo.update>[2] = {};
  if (data.calendar_id !== undefined) fields.calendarId = data.calendar_id;
  if (data.holiday_date !== undefined) fields.holidayDate = data.holiday_date;
  if (data.name !== undefined) fields.name = data.name;
  if (data.is_optional !== undefined) fields.isOptional = data.is_optional;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(ctx, id, fields);
    if (!row) throw new NotFoundError('Holiday not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    throw asConflict(err);
  }
}
