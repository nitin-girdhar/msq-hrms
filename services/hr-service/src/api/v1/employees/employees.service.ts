import type { RoleTxContext } from '@crm/db';
import { logActivity } from '@crm/audit-log';
import { NotFoundError, ForbiddenError } from '../../../lib/errors.js';
import * as repo from './employees.repository.js';
import type {
  CreateEmployeeProfileInput,
  UpdateEmployeeProfileInput,
  ListEmployeeProfilesInput,
} from './employees.schema.js';

const MIN_RANK_TO_VIEW_OTHERS = 60; // org_manager

export async function listEmployees(ctx: RoleTxContext, filters: ListEmployeeProfilesInput) {
  return repo.listEmployees(ctx, filters);
}

export async function getEmployee(ctx: RoleTxContext & { rank: number }, userId: string) {
  if (userId !== ctx.user_id && ctx.rank < MIN_RANK_TO_VIEW_OTHERS) {
    throw new ForbiddenError('Insufficient rank to view another employee profile');
  }
  const employee = await repo.getEmployeeByUserId(ctx, userId);
  if (!employee) throw new NotFoundError('Employee profile not found');
  return employee;
}

export async function createEmployee(ctx: RoleTxContext, data: CreateEmployeeProfileInput) {
  const result = await repo.createEmployee(ctx, data);
  void logActivity({
    action_type: 'employee_profile_created',
    performed_by: ctx.user_id,
    subject_user_id: data.user_id,
    org_id: ctx.org_id,
  });
  return result;
}

export async function updateEmployee(ctx: RoleTxContext, userId: string, data: UpdateEmployeeProfileInput) {
  const result = await repo.updateEmployee(ctx, userId, data);
  if (!result) throw new NotFoundError('Employee profile not found');
  void logActivity({
    action_type: 'employee_profile_updated',
    performed_by: ctx.user_id,
    subject_user_id: userId,
    org_id: ctx.org_id,
    new_value: data,
  });
  return result;
}

export async function listDepartments(ctx: RoleTxContext) {
  return repo.listDepartments(ctx);
}

export async function createDepartment(ctx: RoleTxContext, name: string) {
  return repo.createDepartment(ctx, name);
}

export async function updateDepartment(ctx: RoleTxContext, id: string, data: { name?: string; is_active?: boolean }) {
  const result = await repo.updateDepartment(ctx, id, data);
  if (!result) throw new NotFoundError('Department not found');
  return result;
}

export async function listDesignations(ctx: RoleTxContext) {
  return repo.listDesignations(ctx);
}

export async function createDesignation(ctx: RoleTxContext, name: string) {
  return repo.createDesignation(ctx, name);
}

export async function updateDesignation(ctx: RoleTxContext, id: string, data: { name?: string; is_active?: boolean }) {
  const result = await repo.updateDesignation(ctx, id, data);
  if (!result) throw new NotFoundError('Designation not found');
  return result;
}
