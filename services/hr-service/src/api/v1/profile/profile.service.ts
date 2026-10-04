// ─────────────────────────────────────────────────────────────────────────────
// Profile service — orchestration, activity logging. No SQL (profile.repository),
// no req/res (profile.controller).
// ─────────────────────────────────────────────────────────────────────────────

import { logActivity } from '@platform/audit-log';
import type { RoleTxContext } from '@platform/db';
import * as repo from './profile.repository.js';
import type {
  UpsertPersonalInput,
  CreateEmergencyContactInput,
  UpdateEmergencyContactInput,
  CreateEmployeeNoteInput,
} from './profile.schema.js';

// ── My profile ───────────────────────────────────────────────────────────────
export const getOwnProfile = (ctx: RoleTxContext) => repo.getOwnProfile(ctx);

export async function savePersonal(ctx: RoleTxContext, data: UpsertPersonalInput) {
  await repo.upsertOwnPersonal(ctx, data);
  // The audit row records THAT it changed, never the values: this is personal data.
  void logActivity({
    action_type: 'employee_personal_updated',
    performed_by: ctx.user_id,
    subject_user_id: ctx.user_id,
    org_id: ctx.org_id,
  });
}

export async function addContact(ctx: RoleTxContext, data: CreateEmergencyContactInput) {
  const result = await repo.addOwnContact(ctx, data);
  void logActivity({ action_type: 'emergency_contact_added', performed_by: ctx.user_id, subject_user_id: ctx.user_id, org_id: ctx.org_id });
  return result;
}

export async function updateContact(ctx: RoleTxContext, id: string, data: UpdateEmergencyContactInput) {
  await repo.updateOwnContact(ctx, id, data);
  void logActivity({ action_type: 'emergency_contact_updated', performed_by: ctx.user_id, subject_user_id: ctx.user_id, org_id: ctx.org_id });
}

export async function removeContact(ctx: RoleTxContext, id: string) {
  await repo.removeOwnContact(ctx, id);
  void logActivity({ action_type: 'emergency_contact_removed', performed_by: ctx.user_id, subject_user_id: ctx.user_id, org_id: ctx.org_id });
}

// ── Employee 360 ─────────────────────────────────────────────────────────────
/**
 * `canSeeNotes` is decided by the caller from hr.employees.notes.manage: opening
 * the profile and reading HR notes are separate permissions.
 */
export async function getEmployee360(ctx: RoleTxContext, userId: string, canSeeNotes: boolean) {
  const result = await repo.getEmployee360(ctx, userId, canSeeNotes);
  // Opening someone else's personal data is itself an auditable act.
  if (userId !== ctx.user_id) {
    void logActivity({
      action_type: 'employee_360_viewed',
      performed_by: ctx.user_id,
      subject_user_id: userId,
      org_id: ctx.org_id,
    });
  }
  return result;
}

export async function addNote(ctx: RoleTxContext, userId: string, data: CreateEmployeeNoteInput) {
  const result = await repo.addEmployeeNote(ctx, userId, data);
  void logActivity({
    action_type: 'employee_note_added',
    performed_by: ctx.user_id,
    subject_user_id: userId,
    org_id: ctx.org_id,
    new_value: { note_id: result.id, kind: data.kind },
  });
  return result;
}
