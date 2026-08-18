import { toApiRow, toApiRows } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './holiday-calendars.repository.js';
import type { OrgCtx } from './holiday-calendars.repository.js';
import type { CreateHolidayCalendarInput, UpdateHolidayCalendarInput } from './holiday-calendars.schema.js';

async function assertOrgInTenant(ctx: OrgCtx): Promise<void> {
  if (!(await repo.orgBelongsToTenant(ctx))) {
    throw new BadRequestError('That organization does not belong to this tenant.');
  }
}

function asConflict(err: unknown): Error {
  const msg = (err as Error).message ?? '';
  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return new ConflictError('A holiday calendar with this name already exists for this organization.');
  }
  return err as Error;
}

export async function list(ctx: OrgCtx) {
  await assertOrgInTenant(ctx);
  return toApiRows(await repo.list(ctx));
}

export async function create(ctx: OrgCtx, data: CreateHolidayCalendarInput) {
  await assertOrgInTenant(ctx);
  try {
    const row = await repo.create(ctx, { name: data.name, year: data.year });
    return toApiRow(row);
  } catch (err) {
    throw asConflict(err);
  }
}

export async function update(ctx: OrgCtx, id: string, data: UpdateHolidayCalendarInput) {
  await assertOrgInTenant(ctx);

  const existing = await repo.getById(ctx, id);
  if (!existing || existing.isDeleted) throw new NotFoundError('Holiday calendar not found');

  const fields: Parameters<typeof repo.update>[2] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.year !== undefined) fields.year = data.year;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(ctx, id, fields);
    if (!row) throw new NotFoundError('Holiday calendar not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    throw asConflict(err);
  }
}
