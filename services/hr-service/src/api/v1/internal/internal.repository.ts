import { sql } from 'drizzle-orm';
import { withRoleTx } from '@platform/db';
import { BadRequestError } from '../../../lib/errors.js';
import type { SyncEmployeeProfileInput } from './internal.schema.js';

export type SyncOutcome = 'created' | 'updated' | 'unchanged' | 'deleted';

// Idempotent upsert of the IAM → HR bridge row (hr.employee_profiles).
//
// Runs on the tenant_admin Postgres path (tenantWide), pinned to the caller's
// tenant — NOT withServiceTx/BYPASSRLS. It has to be tenant-wide rather than
// org-scoped: a home-branch move rewrites a row that currently sits in ANOTHER
// branch, which org_isolation_policy would hide. tenant_isolation_policy still
// fences both the read and the WITH CHECK to this one tenant.
//
// Identity-owned facts written here: which branch the profile is filed under, whether it is
// active, and the exit date that follows (de)activation. Everything else HR owns (joining date,
// code, department, grade, weekly off) is left alone once the row exists. Two consequences of
// the home branch moving are handled here because only this path knows it happened:
//   - hr.designations is org-scoped, so the designation is re-pointed at the same-named one in
//     the new branch; with no match it is cleared and metadata.designation_needs_review is set
//     so HR sees it (HR re-picking a designation clears the flag).
//   - a NEW profile starts with the department of the role the person holds in the home branch.
export async function syncEmployeeProfile(data: SyncEmployeeProfileInput): Promise<SyncOutcome> {
  return withRoleTx(
    { role: 'member', tenantWide: true, org_id: data.home_org_id, tenant_id: data.tenant_id, user_id: data.actor_id },
    async (tx) => {
      const orgRows = (await tx.execute(sql`
        SELECT 1 FROM entity.organizations
        WHERE id = ${data.home_org_id}::uuid AND tenant_id = ${data.tenant_id}::uuid AND NOT is_deleted
      `)) as Array<unknown>;
      if (orgRows.length === 0) throw new BadRequestError('home_org_id is not a branch of this tenant');

      // Same guard as POST /hr/employees: a profile is filed under a branch the
      // user actually belongs to — the drift the 2026-08 backfill had to repair.
      const mappingRows = (await tx.execute(sql`
        SELECT 1 FROM iam.user_org_mapping
        WHERE user_id = ${data.user_id}::uuid AND org_id = ${data.home_org_id}::uuid AND is_active
      `)) as Array<unknown>;
      if (mappingRows.length === 0) {
        throw new BadRequestError('User has no active mapping in their home branch');
      }

      const existing = (await tx.execute(sql`
        SELECT org_id::text AS org_id, is_active, date_of_joining::text AS date_of_joining, date_of_exit::text AS date_of_exit
        FROM hr.employee_profiles
        WHERE user_id = ${data.user_id}::uuid AND NOT is_deleted
      `)) as Array<{ org_id: string; is_active: boolean; date_of_joining: string; date_of_exit: string | null }>;

      if (existing.length === 0) {
        // ON CONFLICT covers a profile HR soft-deleted (invisible to the read
        // above, still holding the PK): that was a deliberate HR decision, so it
        // is reported rather than resurrected. tenant_id is resolved from org_id
        // by trg_02_employee_profiles_set_tenant_id; supplied here only because
        // the column is NOT NULL.
        const inserted = (await tx.execute(sql`
          INSERT INTO hr.employee_profiles (user_id, org_id, tenant_id, date_of_joining, is_active, department_id, created_by)
          VALUES (
            ${data.user_id}::uuid, ${data.home_org_id}::uuid, ${data.tenant_id}::uuid,
            COALESCE(${data.date_of_joining ?? null}::date, CURRENT_DATE),
            ${data.is_active},
            (SELECT ur.department_id FROM iam.user_org_mapping m JOIN iam.user_roles ur ON ur.id = m.role_id
              WHERE m.user_id = ${data.user_id}::uuid AND m.org_id = ${data.home_org_id}::uuid AND m.is_active
              LIMIT 1),
            ${data.actor_id}::uuid
          )
          ON CONFLICT (user_id) DO NOTHING
          RETURNING user_id
        `)) as Array<unknown>;
        return inserted.length > 0 ? 'created' : 'deleted';
      }

      const current = existing[0]!;
      const homeMoved = current.org_id !== data.home_org_id;

      // Exit date: explicit value / explicit clear / "today if HR has none". undefined = leave alone.
      let exitDate: string | null | undefined;
      if (data.date_of_exit !== undefined) exitDate = data.date_of_exit;
      else if (data.exit_if_missing && !data.is_active && current.date_of_exit === null) {
        exitDate = (await tx.execute(sql`SELECT CURRENT_DATE::text AS d`) as Array<{ d: string }>)[0]!.d;
      }
      if (exitDate && exitDate < current.date_of_joining) {
        throw new BadRequestError(`Last working day ${exitDate} is before the joining date ${current.date_of_joining}`);
      }
      const exitChanged = exitDate !== undefined && exitDate !== current.date_of_exit;
      const reasonGiven = data.exit_reason !== undefined && !data.is_active;

      if (!homeMoved && current.is_active === data.is_active && !exitChanged && !reasonGiven) return 'unchanged';

      const exitSet = exitDate !== undefined ? sql`, date_of_exit = ${exitDate}::date` : sql``;
      // metadata carries two soft facts (no column for either): the exit reason, and a flag when the
      // designation could not follow a home-branch move. Every SET expression reads the OLD row, so the
      // designation checks below are against the designation the person had before the move.
      let meta = sql`COALESCE(metadata, '{}'::jsonb)`;
      if (homeMoved) {
        meta = sql`(${meta}) || jsonb_build_object('designation_needs_review',
          (designation_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM hr.designations d1
            JOIN hr.designations d2 ON d2.org_id = ${data.home_org_id}::uuid AND d2.name = d1.name AND NOT d2.is_deleted
            WHERE d1.id = designation_id)))`;
      }
      if (reasonGiven) meta = sql`(${meta}) || jsonb_build_object('exit_reason', ${data.exit_reason}::text)`;
      else if (exitDate === null) meta = sql`(${meta}) - 'exit_reason'`;
      const metaSet = homeMoved || reasonGiven || exitDate === null ? sql`, metadata = ${meta}` : sql``;
      // Designations are org-scoped: carry the same-named one across (null when there is none).
      const designationSet = homeMoved
        ? sql`, designation_id = (
            SELECT d2.id FROM hr.designations d1
            JOIN hr.designations d2 ON d2.org_id = ${data.home_org_id}::uuid AND d2.name = d1.name AND NOT d2.is_deleted
            WHERE d1.id = designation_id LIMIT 1)`
        : sql``;

      await tx.execute(sql`
        UPDATE hr.employee_profiles
        SET org_id = ${data.home_org_id}::uuid, is_active = ${data.is_active}
            ${exitSet} ${designationSet} ${metaSet}
        WHERE user_id = ${data.user_id}::uuid AND NOT is_deleted
      `);
      return 'updated';
    },
  );
}
