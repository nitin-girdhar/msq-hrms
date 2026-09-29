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
// Only the identity-owned facts are written: which branch the profile is filed
// under, and whether it is active. Everything HR edits on the Employees screen
// (joining date, code, department, designation, weekly off) is left alone once
// the row exists.
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
        SELECT org_id::text AS org_id, is_active
        FROM hr.employee_profiles
        WHERE user_id = ${data.user_id}::uuid AND NOT is_deleted
      `)) as Array<{ org_id: string; is_active: boolean }>;

      if (existing.length === 0) {
        // ON CONFLICT covers a profile HR soft-deleted (invisible to the read
        // above, still holding the PK): that was a deliberate HR decision, so it
        // is reported rather than resurrected. tenant_id is resolved from org_id
        // by trg_02_employee_profiles_set_tenant_id; supplied here only because
        // the column is NOT NULL.
        const inserted = (await tx.execute(sql`
          INSERT INTO hr.employee_profiles (user_id, org_id, tenant_id, date_of_joining, is_active, created_by)
          VALUES (
            ${data.user_id}::uuid, ${data.home_org_id}::uuid, ${data.tenant_id}::uuid,
            COALESCE(${data.date_of_joining ?? null}::date, CURRENT_DATE),
            ${data.is_active}, ${data.actor_id}::uuid
          )
          ON CONFLICT (user_id) DO NOTHING
          RETURNING user_id
        `)) as Array<unknown>;
        return inserted.length > 0 ? 'created' : 'deleted';
      }

      const current = existing[0]!;
      if (current.org_id === data.home_org_id && current.is_active === data.is_active) return 'unchanged';

      await tx.execute(sql`
        UPDATE hr.employee_profiles
        SET org_id = ${data.home_org_id}::uuid, is_active = ${data.is_active}
        WHERE user_id = ${data.user_id}::uuid AND NOT is_deleted
      `);
      return 'updated';
    },
  );
}
