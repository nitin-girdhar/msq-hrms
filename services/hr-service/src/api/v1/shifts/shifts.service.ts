import { toApiRow, toApiRows } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './shifts.repository.js';
import type { OrgCtx } from './shifts.repository.js';
import type { CreateShiftInput, UpdateShiftInput } from './shifts.schema.js';

async function assertOrgInTenant(ctx: OrgCtx): Promise<void> {
  if (!(await repo.orgBelongsToTenant(ctx))) {
    throw new BadRequestError('That organization does not belong to this tenant.');
  }
}

function asConflict(err: unknown): Error {
  const msg = (err as Error).message ?? '';
  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return new ConflictError('A shift with this name already exists for this organization.');
  }
  return err as Error;
}

export async function list(ctx: OrgCtx) {
  await assertOrgInTenant(ctx);
  return toApiRows(await repo.list(ctx));
}

export async function create(ctx: OrgCtx, data: CreateShiftInput) {
  await assertOrgInTenant(ctx);

  try {
    const row = await repo.create(ctx, {
      name: data.name,
      startTime: data.start_time,
      endTime: data.end_time,
      ...(data.grace_minutes !== undefined ? { graceMinutes: data.grace_minutes } : {}),
      ...(data.min_half_day_minutes !== undefined ? { minHalfDayMinutes: data.min_half_day_minutes } : {}),
      ...(data.min_full_day_minutes !== undefined ? { minFullDayMinutes: data.min_full_day_minutes } : {}),
      ...(data.is_night_shift !== undefined ? { isNightShift: data.is_night_shift } : {}),
      ...(data.is_split !== undefined ? { isSplit: data.is_split } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    throw asConflict(err);
  }
}

export async function update(ctx: OrgCtx, id: string, data: UpdateShiftInput) {
  await assertOrgInTenant(ctx);

  const existing = await repo.getById(ctx, id);
  if (!existing || existing.isDeleted) throw new NotFoundError('Shift not found');

  const fields: Parameters<typeof repo.update>[2] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.start_time !== undefined) fields.startTime = data.start_time;
  if (data.end_time !== undefined) fields.endTime = data.end_time;
  if (data.grace_minutes !== undefined) fields.graceMinutes = data.grace_minutes;
  if (data.min_half_day_minutes !== undefined) fields.minHalfDayMinutes = data.min_half_day_minutes;
  if (data.min_full_day_minutes !== undefined) fields.minFullDayMinutes = data.min_full_day_minutes;
  if (data.is_night_shift !== undefined) fields.isNightShift = data.is_night_shift;
  if (data.is_split !== undefined) fields.isSplit = data.is_split;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(ctx, id, fields);
    if (!row) throw new NotFoundError('Shift not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    throw asConflict(err);
  }
}
