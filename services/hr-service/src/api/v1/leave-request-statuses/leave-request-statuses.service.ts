import { toApiRow, toApiRows } from '@platform/db';
import type { RoleTxContext } from '@platform/db';
import { isReservedLookupName } from '@platform/authz';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './leave-request-statuses.repository.js';
import type {
  CreateLeaveRequestStatusInput,
  UpdateLeaveRequestStatusInput,
} from './leave-request-statuses.schema.js';

const SLUG = 'leave-request-statuses';

export async function list(ctx: RoleTxContext) {
  return toApiRows(await repo.list(ctx));
}

export async function create(ctx: RoleTxContext, data: CreateLeaveRequestStatusInput) {
  try {
    const row = await repo.create(ctx, {
      name: data.name,
      label: data.label,
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A leave request status with this name already exists.');
    throw err;
  }
}

export async function update(ctx: RoleTxContext, id: string, data: UpdateLeaveRequestStatusInput) {
  // The reserved rows are the leave workflow's machine vocabulary: is_open is
  // derived from name IN ('pending','approved') by a BEFORE trigger, and the
  // approve/reject/cancel paths resolve their target status by name. Renaming
  // or deactivating one does not fail — it quietly stops leave from working, so
  // the guard lives here (authoritative) as well as in the admin UI (cosmetic).
  const existing = await repo.getById(ctx, id);
  if (!existing) throw new NotFoundError('Leave request status not found');

  if (isReservedLookupName(SLUG, existing.name)) {
    if (data.name !== undefined && data.name !== existing.name) {
      throw new BadRequestError(
        `'${existing.name}' is a reserved leave status — its name is fixed by the leave workflow. Change the label instead.`,
      );
    }
    if (data.is_active === false) {
      throw new BadRequestError(
        `'${existing.name}' is a reserved leave status and cannot be deactivated — leave approval depends on it.`,
      );
    }
  }

  const fields: Parameters<typeof repo.update>[2] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.label !== undefined) fields.label = data.label;
  if (data.description !== undefined) fields.description = data.description;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(ctx, id, fields);
    if (!row) throw new NotFoundError('Leave request status not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A leave request status with this name already exists.');
    throw err;
  }
}
