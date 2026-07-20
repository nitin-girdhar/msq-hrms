import { toApiRow, toApiRows } from '@crm/db';
import type { RoleTxContext } from '@crm/db';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './leave-types.repository.js';
import type { CreateLeaveTypeInput, UpdateLeaveTypeInput } from './leave-types.schema.js';

export async function list(ctx: RoleTxContext) {
  return toApiRows(await repo.list(ctx));
}

export async function create(ctx: RoleTxContext, data: CreateLeaveTypeInput) {
  try {
    const row = await repo.create(ctx, {
      name: data.name,
      label: data.label,
      isPaid: data.is_paid,
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.sort_order !== undefined ? { sortOrder: data.sort_order } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A leave type with this name already exists.');
    throw err;
  }
}

export async function update(ctx: RoleTxContext, id: string, data: UpdateLeaveTypeInput) {
  const fields: Parameters<typeof repo.update>[2] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.label !== undefined) fields.label = data.label;
  if (data.description !== undefined) fields.description = data.description;
  if (data.is_paid !== undefined) fields.isPaid = data.is_paid;
  if (data.sort_order !== undefined) fields.sortOrder = data.sort_order;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(ctx, id, fields);
    if (!row) throw new NotFoundError('Leave type not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A leave type with this name already exists.');
    throw err;
  }
}
