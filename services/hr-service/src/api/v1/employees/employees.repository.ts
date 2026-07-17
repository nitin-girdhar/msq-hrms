import { sql, eq, and } from 'drizzle-orm';
import { withRoleTx } from '@crm/db';
import type { RoleTxContext, DrizzleTx } from '@crm/db';
import { employeeProfilesTable, departmentsTable, designationsTable, employmentTypesTable } from '@crm/db/schema';
import { BadRequestError, ConflictError } from '../../../lib/errors.js';
import type {
  CreateEmployeeProfileInput,
  UpdateEmployeeProfileInput,
  ListEmployeeProfilesInput,
} from './employees.schema.js';

const SELECT_FIELDS = sql`
  ep.user_id, ep.org_id, ep.employee_code, ep.date_of_joining, ep.date_of_exit,
  ep.probation_end_date, ep.weekly_off_pattern, ep.is_active, ep.created_at, ep.updated_at,
  u.full_name, u.email, u.mobile, ur.name AS role_name,
  et.name AS employment_type_name,
  d.id AS department_id, d.name AS department_name,
  ds.id AS designation_id, ds.name AS designation_name
`;

const JOINS = sql`
  FROM hr.employee_profiles ep
  JOIN iam.users u ON u.id = ep.user_id
  JOIN iam.user_roles ur ON ur.id = u.role_id
  LEFT JOIN hr.employment_types et ON et.id = ep.employment_type_id
  LEFT JOIN hr.departments d ON d.id = ep.department_id
  LEFT JOIN hr.designations ds ON ds.id = ep.designation_id
`;

export async function listEmployees(ctx: RoleTxContext, filters: ListEmployeeProfilesInput) {
  return withRoleTx(ctx, async (tx) => {
    const { page, limit, search } = filters;
    const offset = (page - 1) * limit;
    const searchClause = search
      ? sql`AND (u.full_name ILIKE ${'%' + search + '%'} OR ep.employee_code ILIKE ${'%' + search + '%'})`
      : sql``;

    const rows = (await tx.execute(sql`
      SELECT ${SELECT_FIELDS}
      ${JOINS}
      WHERE ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted
      ${searchClause}
      ORDER BY u.full_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `)) as Array<Record<string, unknown>>;

    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      ${JOINS}
      WHERE ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted
      ${searchClause}
    `)) as Array<{ count: number }>;

    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

export async function getEmployeeByUserId(ctx: RoleTxContext, userId: string) {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${SELECT_FIELDS}
      ${JOINS}
      WHERE ep.user_id = ${userId} AND NOT ep.is_deleted
    `)) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
}

async function resolveEmploymentTypeId(tx: DrizzleTx, name: string) {
  const [row] = await tx
    .select({ id: employmentTypesTable.id })
    .from(employmentTypesTable)
    .where(and(eq(employmentTypesTable.name, name), eq(employmentTypesTable.isActive, true)))
    .limit(1);
  if (!row) throw new BadRequestError(`Employment type not found: ${name}`);
  return row.id;
}

async function resolveDepartmentId(tx: DrizzleTx, orgId: string, name: string) {
  const [row] = await tx
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(and(eq(departmentsTable.orgId, orgId), eq(departmentsTable.name, name), eq(departmentsTable.isDeleted, false)))
    .limit(1);
  if (!row) throw new BadRequestError(`Department not found: ${name}`);
  return row.id;
}

async function resolveDesignationId(tx: DrizzleTx, orgId: string, name: string) {
  const [row] = await tx
    .select({ id: designationsTable.id })
    .from(designationsTable)
    .where(and(eq(designationsTable.orgId, orgId), eq(designationsTable.name, name), eq(designationsTable.isDeleted, false)))
    .limit(1);
  if (!row) throw new BadRequestError(`Designation not found: ${name}`);
  return row.id;
}

export async function createEmployee(ctx: RoleTxContext, data: CreateEmployeeProfileInput) {
  return withRoleTx(ctx, async (tx) => {
    const mappingRows = (await tx.execute(sql`
      SELECT 1 FROM iam.user_org_mapping
      WHERE user_id = ${data.user_id} AND org_id = ${ctx.org_id} AND is_active
    `)) as Array<Record<string, unknown>>;
    if (mappingRows.length === 0) {
      throw new BadRequestError('Target user has no active org mapping for this org');
    }

    const existingRows = (await tx.execute(sql`
      SELECT 1 FROM hr.employee_profiles WHERE user_id = ${data.user_id} AND NOT is_deleted
    `)) as Array<Record<string, unknown>>;
    if (existingRows.length > 0) {
      throw new ConflictError('Employee profile already exists for this user');
    }

    const [employmentTypeId, departmentId, designationId] = await Promise.all([
      data.employment_type_name ? resolveEmploymentTypeId(tx, data.employment_type_name) : Promise.resolve(null),
      data.department_name ? resolveDepartmentId(tx, ctx.org_id, data.department_name) : Promise.resolve(null),
      data.designation_name ? resolveDesignationId(tx, ctx.org_id, data.designation_name) : Promise.resolve(null),
    ]);

    const [inserted] = await tx
      .insert(employeeProfilesTable)
      .values({
        userId: data.user_id,
        orgId: ctx.org_id,
        // Placeholder — trg_02_employee_profiles_set_tenant_id resolves the real
        // tenant_id from org_id before the row is written; must be a syntactically
        // valid UUID for the insert to type-check, hence reusing org_id here.
        tenantId: ctx.org_id,
        employeeCode: data.employee_code ?? null,
        dateOfJoining: data.date_of_joining,
        dateOfExit: data.date_of_exit ?? null,
        employmentTypeId,
        departmentId,
        designationId,
        probationEndDate: data.probation_end_date ?? null,
        weeklyOffPattern: data.weekly_off_pattern ?? [0, 6],
        createdBy: ctx.user_id,
      })
      .returning({ userId: employeeProfilesTable.userId });

    return inserted!;
  });
}

export async function updateEmployee(ctx: RoleTxContext, userId: string, data: UpdateEmployeeProfileInput) {
  return withRoleTx(ctx, async (tx) => {
    const updateData: Record<string, unknown> = {};

    if (data.employee_code !== undefined) updateData['employeeCode'] = data.employee_code;
    if (data.date_of_joining !== undefined) updateData['dateOfJoining'] = data.date_of_joining;
    if (data.date_of_exit !== undefined) updateData['dateOfExit'] = data.date_of_exit;
    if (data.probation_end_date !== undefined) updateData['probationEndDate'] = data.probation_end_date;
    if (data.weekly_off_pattern !== undefined) updateData['weeklyOffPattern'] = data.weekly_off_pattern;
    if (data.is_active !== undefined) updateData['isActive'] = data.is_active;

    if (data.employment_type_name !== undefined) {
      updateData['employmentTypeId'] = data.employment_type_name
        ? await resolveEmploymentTypeId(tx, data.employment_type_name)
        : null;
    }
    if (data.department_name !== undefined) {
      updateData['departmentId'] = data.department_name
        ? await resolveDepartmentId(tx, ctx.org_id, data.department_name)
        : null;
    }
    if (data.designation_name !== undefined) {
      updateData['designationId'] = data.designation_name
        ? await resolveDesignationId(tx, ctx.org_id, data.designation_name)
        : null;
    }

    if (Object.keys(updateData).length === 0) return null;

    const [updated] = await tx
      .update(employeeProfilesTable)
      .set(updateData as Record<string, unknown>)
      .where(and(
        eq(employeeProfilesTable.userId, userId),
        eq(employeeProfilesTable.orgId, ctx.org_id),
        eq(employeeProfilesTable.isDeleted, false),
      ))
      .returning({ userId: employeeProfilesTable.userId });

    return updated ?? null;
  });
}

export async function listDepartments(ctx: RoleTxContext) {
  return withRoleTx(ctx, async (tx) => {
    return tx
      .select({ id: departmentsTable.id, name: departmentsTable.name, isActive: departmentsTable.isActive })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.orgId, ctx.org_id), eq(departmentsTable.isDeleted, false)))
      .orderBy(departmentsTable.name);
  });
}

export async function createDepartment(ctx: RoleTxContext, name: string) {
  return withRoleTx(ctx, async (tx) => {
    const [inserted] = await tx
      .insert(departmentsTable)
      .values({ orgId: ctx.org_id, name, createdBy: ctx.user_id })
      .returning({ id: departmentsTable.id });
    return inserted!;
  });
}

export async function updateDepartment(ctx: RoleTxContext, id: string, data: { name?: string; is_active?: boolean }) {
  return withRoleTx(ctx, async (tx) => {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.is_active !== undefined) updateData['isActive'] = data.is_active;
    if (Object.keys(updateData).length === 0) return null;

    const [updated] = await tx
      .update(departmentsTable)
      .set(updateData)
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.orgId, ctx.org_id), eq(departmentsTable.isDeleted, false)))
      .returning({ id: departmentsTable.id });
    return updated ?? null;
  });
}

export async function listDesignations(ctx: RoleTxContext) {
  return withRoleTx(ctx, async (tx) => {
    return tx
      .select({ id: designationsTable.id, name: designationsTable.name, isActive: designationsTable.isActive })
      .from(designationsTable)
      .where(and(eq(designationsTable.orgId, ctx.org_id), eq(designationsTable.isDeleted, false)))
      .orderBy(designationsTable.name);
  });
}

export async function createDesignation(ctx: RoleTxContext, name: string) {
  return withRoleTx(ctx, async (tx) => {
    const [inserted] = await tx
      .insert(designationsTable)
      .values({ orgId: ctx.org_id, name, createdBy: ctx.user_id })
      .returning({ id: designationsTable.id });
    return inserted!;
  });
}

export async function updateDesignation(ctx: RoleTxContext, id: string, data: { name?: string; is_active?: boolean }) {
  return withRoleTx(ctx, async (tx) => {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.is_active !== undefined) updateData['isActive'] = data.is_active;
    if (Object.keys(updateData).length === 0) return null;

    const [updated] = await tx
      .update(designationsTable)
      .set(updateData)
      .where(and(eq(designationsTable.id, id), eq(designationsTable.orgId, ctx.org_id), eq(designationsTable.isDeleted, false)))
      .returning({ id: designationsTable.id });
    return updated ?? null;
  });
}
