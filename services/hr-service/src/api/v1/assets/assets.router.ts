import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { withServiceTx, pgErrorCode, type DrizzleTx } from '@platform/db';
import { logActivity } from '@platform/audit-log';
import { CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import { createAssetSchema, assignAssetSchema, type CreateAssetInput, type AssignAssetInput } from '@hr/validation';

// Assets (schema 1.63.0). Inventory is HR data with no app_user policy, so EVERY read and
// write runs in the service transaction: the employee view is capability-gated and
// scoped to the verified caller in SQL, and every HR query is fenced to the caller's org.
const audit = (request: FastifyRequest, action: string, subject: string, assetId: string) =>
  void logActivity({ action_type: action, performed_by: request.auth.user_id, subject_user_id: subject, org_id: request.auth.org_id, new_value: { asset_id: assetId } });

async function assetInOrg(tx: DrizzleTx, orgId: string, id: string) {
  const rows = (await tx.execute(sql`
    SELECT id::text, status FROM hr.assets WHERE id = ${id} AND org_id = ${orgId} AND NOT is_deleted FOR UPDATE
  `)) as unknown as Array<{ id: string; status: string }>;
  if (!rows[0]) throw new NotFoundError('Asset not found');
  return rows[0];
}

export async function assetsRouter(app: FastifyInstance) {
  const view = requireCapability(CAPABILITY.HR_EMPLOYEES_ASSETS_VIEW);
  const manage = requireCapability(CAPABILITY.HR_EMPLOYEES_ASSETS_MANAGE, 'You do not have permission to manage assets');

  // What the caller currently holds. The id comes from request.auth, never the request.
  app.get('/assets/mine', { preHandler: [authenticate, view] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const data = await withServiceTx(async (tx) =>
      tx.execute(sql`
        SELECT a.id::text, a.asset_tag, a.name, a.category, a.serial_no, g.assigned_on::text AS assigned_on
        FROM hr.asset_assignments g JOIN hr.assets a ON a.id = g.asset_id
        WHERE g.user_id = ${user_id} AND g.org_id = ${org_id} AND g.returned_on IS NULL AND NOT g.is_deleted AND NOT a.is_deleted
        ORDER BY g.assigned_on DESC`),
    );
    return reply.send({ success: true, data });
  });

  app.get('/assets', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const { org_id } = request.auth;
    const data = await withServiceTx(async (tx) =>
      tx.execute(sql`
        SELECT a.id::text, a.asset_tag, a.name, a.category, a.serial_no, a.status, a.notes,
               g.user_id::text AS holder_id, u.full_name AS holder_name, g.assigned_on::text AS assigned_on
        FROM hr.assets a
        LEFT JOIN hr.asset_assignments g ON g.asset_id = a.id AND g.returned_on IS NULL AND NOT g.is_deleted
        LEFT JOIN iam.users u ON u.id = g.user_id
        WHERE a.org_id = ${org_id} AND NOT a.is_deleted
        ORDER BY a.asset_tag LIMIT 500`),
    );
    return reply.send({ success: true, data });
  });

  app.post('/assets', { preHandler: [authenticate, manage, validate({ body: createAssetSchema })] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const b = request.body as CreateAssetInput;
    try {
      const id = await withServiceTx(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${user_id}, true)`);
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${org_id}, true)`);
        const rows = (await tx.execute(sql`
          INSERT INTO hr.assets (org_id, asset_tag, name, category, serial_no, notes, created_by)
          VALUES (${org_id}, ${b.asset_tag}, ${b.name}, ${b.category}, ${b.serial_no ?? null}, ${b.notes ?? null}, ${user_id})
          RETURNING id::text`)) as unknown as Array<{ id: string }>;
        return rows[0]!.id;
      });
      audit(request, 'asset_created', user_id, id);
      return reply.status(201).send({ success: true, data: { id } });
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new ConflictError('An asset with that tag already exists');
      throw err;
    }
  });

  app.post('/assets/:id/assign', { preHandler: [authenticate, manage, validate({ body: assignAssetSchema })] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const { id } = request.params as { id: string };
    const b = request.body as AssignAssetInput;
    await withServiceTx(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${user_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${org_id}, true)`);
      const asset = await assetInOrg(tx, org_id, id);
      if (asset.status === 'retired') throw new ConflictError('That asset is retired');
      if (asset.status === 'assigned') throw new ConflictError('That asset is already assigned; take it back first');
      const emp = (await tx.execute(sql`
        SELECT 1 FROM hr.employee_profiles WHERE user_id = ${b.user_id} AND org_id = ${org_id} AND NOT is_deleted`)) as unknown as unknown[];
      if (emp.length === 0) throw new NotFoundError('Employee not found');
      await tx.execute(sql`
        INSERT INTO hr.asset_assignments (asset_id, user_id, org_id, note, created_by)
        VALUES (${id}, ${b.user_id}, ${org_id}, ${b.note ?? null}, ${user_id})`);
      await tx.execute(sql`UPDATE hr.assets SET status = 'assigned' WHERE id = ${id}`);
    });
    audit(request, 'asset_assigned', b.user_id, id);
    return reply.status(204).send();
  });

  app.post('/assets/:id/return', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const { id } = request.params as { id: string };
    let holder = user_id;
    await withServiceTx(async (tx) => {
      await assetInOrg(tx, org_id, id);
      const rows = (await tx.execute(sql`
        UPDATE hr.asset_assignments SET returned_on = GREATEST(CURRENT_DATE, assigned_on)
        WHERE asset_id = ${id} AND org_id = ${org_id} AND returned_on IS NULL AND NOT is_deleted
        RETURNING user_id::text`)) as unknown as Array<{ user_id: string }>;
      if (rows.length === 0) throw new ConflictError('That asset is not currently assigned');
      holder = rows[0]!.user_id;
      await tx.execute(sql`UPDATE hr.assets SET status = 'in_stock' WHERE id = ${id}`);
    });
    audit(request, 'asset_returned', holder, id);
    return reply.status(204).send();
  });
}
