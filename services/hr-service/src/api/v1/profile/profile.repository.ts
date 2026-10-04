// ─────────────────────────────────────────────────────────────────────────────
// Profile repository — My profile (self) and Employee 360 (HR).
//
// Two access paths, on purpose (see the 1.60.0 notes in 09_schema_version.sql):
//   - SELF reads/writes run in withRoleTx. hr.employee_personal and
//     hr.emergency_contacts carry only a self policy for app_user, so the
//     database itself pins every statement to the caller's own rows.
//   - HR reads/writes of ANOTHER person's data run in the service transaction
//     (BYPASSRLS) after the controller has checked the capability, and every
//     query is explicitly scoped to the gateway-verified org. The target must
//     belong to the caller's org; otherwise it is "not found", never "forbidden",
//     so nothing about a foreign id leaks.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, pgErrorCode, type RoleTxContext, type DrizzleTx } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import type {
  UpsertPersonalInput,
  CreateEmergencyContactInput,
  UpdateEmergencyContactInput,
  CreateEmployeeNoteInput,
} from '@hr/validation';

type Row = Record<string, unknown>;

export interface PersonalDetails {
  preferred_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  blood_group: string | null;
  nationality: string | null;
  personal_email: string | null;
  current_address: string | null;
  permanent_address: string | null;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relation: string;
  phone: string;
  is_primary: boolean;
}

export interface EmployeeNote {
  id: string;
  kind: string;
  body: string;
  author_name: string | null;
  created_at: string;
}

const PERSONAL_COLUMNS = sql`
  preferred_name, date_of_birth::text AS date_of_birth, gender, marital_status, blood_group,
  nationality, personal_email, current_address, permanent_address
`;

const CONTACT_COLUMNS = sql`id::text, name, relation, phone, is_primary`;

/** '' and undefined both mean "no value" — stored as NULL so the column stays clean. */
function nul(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

// ═════════════════════════════════════════════════════════════════════════════
// MY PROFILE (self)
// ═════════════════════════════════════════════════════════════════════════════
export async function getOwnProfile(ctx: RoleTxContext): Promise<{ personal: PersonalDetails | null; contacts: EmergencyContact[] }> {
  return withRoleTx(ctx, async (tx) => {
    const personal = (await tx.execute(sql`
      SELECT ${PERSONAL_COLUMNS} FROM hr.employee_personal
      WHERE user_id = ${ctx.user_id} AND NOT is_deleted
    `)) as unknown as PersonalDetails[];
    const contacts = (await tx.execute(sql`
      SELECT ${CONTACT_COLUMNS} FROM hr.emergency_contacts
      WHERE user_id = ${ctx.user_id} AND NOT is_deleted
      ORDER BY is_primary DESC, created_at
    `)) as unknown as EmergencyContact[];
    return { personal: personal[0] ?? null, contacts };
  });
}

export async function upsertOwnPersonal(ctx: RoleTxContext, data: UpsertPersonalInput): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    await tx.execute(sql`
      INSERT INTO hr.employee_personal
        (user_id, preferred_name, date_of_birth, gender, marital_status, blood_group,
         nationality, personal_email, current_address, permanent_address)
      VALUES
        (${ctx.user_id}, ${nul(data.preferred_name)}, ${nul(data.date_of_birth)}::date, ${nul(data.gender)},
         ${nul(data.marital_status)}, ${nul(data.blood_group)}, ${nul(data.nationality)},
         ${nul(data.personal_email)}, ${nul(data.current_address)}, ${nul(data.permanent_address)})
      ON CONFLICT (user_id) DO UPDATE SET
        preferred_name = EXCLUDED.preferred_name, date_of_birth = EXCLUDED.date_of_birth,
        gender = EXCLUDED.gender, marital_status = EXCLUDED.marital_status,
        blood_group = EXCLUDED.blood_group, nationality = EXCLUDED.nationality,
        personal_email = EXCLUDED.personal_email, current_address = EXCLUDED.current_address,
        permanent_address = EXCLUDED.permanent_address, is_deleted = FALSE, is_active = TRUE
    `);
  });
}

/** Only one primary contact per person: promoting one demotes the others in the same transaction. */
async function demoteOtherPrimaries(tx: DrizzleTx, userId: string, exceptId: string | null): Promise<void> {
  await tx.execute(sql`
    UPDATE hr.emergency_contacts SET is_primary = FALSE
    WHERE user_id = ${userId} AND is_primary AND NOT is_deleted
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
  `);
}

export async function addOwnContact(ctx: RoleTxContext, data: CreateEmergencyContactInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    // A person's first contact is their primary one without having to say so.
    const existing = (await tx.execute(sql`
      SELECT count(*)::int AS n FROM hr.emergency_contacts WHERE user_id = ${ctx.user_id} AND NOT is_deleted
    `)) as unknown as Array<{ n: number }>;
    const makePrimary = data.is_primary || (existing[0]?.n ?? 0) === 0;
    if (makePrimary) await demoteOtherPrimaries(tx, ctx.user_id, null);
    try {
      const rows = (await tx.execute(sql`
        INSERT INTO hr.emergency_contacts (user_id, name, relation, phone, is_primary)
        VALUES (${ctx.user_id}, ${data.name}, ${data.relation}, ${data.phone}, ${makePrimary})
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      return { id: rows[0]!.id };
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new ConflictError('You already have a primary contact');
      throw err;
    }
  });
}

export async function updateOwnContact(ctx: RoleTxContext, id: string, data: UpdateEmergencyContactInput): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const current = (await tx.execute(sql`
      SELECT name, relation, phone, is_primary FROM hr.emergency_contacts
      WHERE id = ${id} AND user_id = ${ctx.user_id} AND NOT is_deleted
    `)) as unknown as Array<{ name: string; relation: string; phone: string; is_primary: boolean }>;
    const row = current[0];
    if (!row) throw new NotFoundError('Emergency contact not found');
    const isPrimary = data.is_primary ?? row.is_primary;
    if (isPrimary && !row.is_primary) await demoteOtherPrimaries(tx, ctx.user_id, id);
    await tx.execute(sql`
      UPDATE hr.emergency_contacts
      SET name = ${data.name ?? row.name}, relation = ${data.relation ?? row.relation},
          phone = ${data.phone ?? row.phone}, is_primary = ${isPrimary}
      WHERE id = ${id} AND user_id = ${ctx.user_id}
    `);
  });
}

/** Soft delete (no DELETE grant for app_user): flag it deleted, and un-flag active (a CHECK forbids both). */
export async function removeOwnContact(ctx: RoleTxContext, id: string): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const res = (await tx.execute(sql`
      UPDATE hr.emergency_contacts
      SET is_deleted = TRUE, is_active = FALSE, is_primary = FALSE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id}
      WHERE id = ${id} AND user_id = ${ctx.user_id} AND NOT is_deleted
      RETURNING id::text
    `)) as unknown as Row[];
    if (res.length === 0) throw new NotFoundError('Emergency contact not found');
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// EMPLOYEE 360 (HR — service transaction, capability checked by the caller)
// ═════════════════════════════════════════════════════════════════════════════
export interface Employee360 {
  header: Row;
  personal: PersonalDetails | null;
  contacts: EmergencyContact[];
  balances: Array<{ leave_type_label: string; balance: number }>;
  notes: EmployeeNote[];
}

export async function getEmployee360(ctx: RoleTxContext, userId: string, includeNotes: boolean): Promise<Employee360> {
  return withServiceTx(async (tx) => {
    // The org fence: a person who is not in the caller's org is simply not found.
    const header = (await tx.execute(sql`
      SELECT ep.user_id::text, u.full_name, u.email, u.mobile, ep.employee_code,
             ep.date_of_joining::text AS date_of_joining, ep.date_of_exit::text AS date_of_exit,
             ep.probation_end_date::text AS probation_end_date, ep.weekly_off_pattern, ep.is_active,
             et.label AS employment_type_label, d.name AS department_name, ds.name AS designation_name,
             ur.name AS role_name, mgr.id::text AS manager_id, mgr.full_name AS manager_name
      FROM hr.employee_profiles ep
      JOIN iam.users u ON u.id = ep.user_id
      JOIN iam.user_roles ur ON ur.id = u.role_id
      LEFT JOIN hr.employment_types et ON et.id = ep.employment_type_id
      LEFT JOIN iam.departments d ON d.id = ep.department_id
      LEFT JOIN hr.designations ds ON ds.id = ep.designation_id
      LEFT JOIN iam.users mgr ON mgr.id = u.manager_id
      WHERE ep.user_id = ${userId} AND ep.org_id = ${ctx.org_id} AND NOT ep.is_deleted
    `)) as unknown as Row[];
    if (!header[0]) throw new NotFoundError('Employee not found');

    const personal = (await tx.execute(sql`
      SELECT ${PERSONAL_COLUMNS} FROM hr.employee_personal
      WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as PersonalDetails[];

    const contacts = (await tx.execute(sql`
      SELECT ${CONTACT_COLUMNS} FROM hr.emergency_contacts
      WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND NOT is_deleted
      ORDER BY is_primary DESC, created_at
    `)) as unknown as EmergencyContact[];

    const balances = (await tx.execute(sql`
      SELECT leave_type_label, balance::float8 AS balance
      FROM hr.vw_leave_balances
      WHERE user_id = ${userId} AND org_id = ${ctx.org_id}
      ORDER BY leave_type_label
    `)) as unknown as Array<{ leave_type_label: string; balance: number }>;

    // HR notes are visible only to people who may manage them; everyone else who
    // can open a 360 simply gets an empty timeline.
    const notes = includeNotes
      ? ((await tx.execute(sql`
          SELECT n.id::text, n.kind, n.body, a.full_name AS author_name, n.created_at::text AS created_at
          FROM hr.employee_notes n
          LEFT JOIN iam.users a ON a.id = n.author_id
          WHERE n.user_id = ${userId} AND n.org_id = ${ctx.org_id} AND NOT n.is_deleted
          ORDER BY n.created_at DESC
          LIMIT 100
        `)) as unknown as EmployeeNote[])
      : [];

    return { header: header[0]!, personal: personal[0] ?? null, contacts, balances, notes };
  });
}

export async function addEmployeeNote(ctx: RoleTxContext, userId: string, data: CreateEmployeeNoteInput): Promise<{ id: string }> {
  return withServiceTx(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
    const exists = (await tx.execute(sql`
      SELECT 1 FROM hr.employee_profiles WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as unknown[];
    if (exists.length === 0) throw new NotFoundError('Employee not found');
    if (userId === ctx.user_id) throw new BadRequestError('You cannot add an HR note to your own profile');
    const rows = (await tx.execute(sql`
      INSERT INTO hr.employee_notes (user_id, org_id, author_id, kind, body, created_by)
      VALUES (${userId}, ${ctx.org_id}, ${ctx.user_id}, ${data.kind}, ${data.body}, ${ctx.user_id})
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    return { id: rows[0]!.id };
  });
}
