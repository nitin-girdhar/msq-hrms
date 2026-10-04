import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx } from '@platform/db';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { NotFoundError } from '../../../lib/errors.js';
import { createAnnouncementSchema, type CreateAnnouncementInput } from '@hr/validation';

// Announcements (schema 1.63.0).
//   - Reading and marking read run in withRoleTx: the table's policy already limits an
//     employee to PUBLISHED, unexpired rows in their branch, and announcement_reads to
//     their own rows, so the database enforces both independently of this code.
//   - Drafting, publishing and retiring run in the service transaction behind
//     hr.employees.announcements.manage, org-fenced on every query.
function ctxOf(request: FastifyRequest) {
  const { org_id, user_id, role, tenant_id } = request.auth;
  return { org_id, user_id, role, tenant_id, readOnly: !can(request.auth, CAPABILITY.PLATFORM_WRITE) };
}
const audit = (request: FastifyRequest, action: string, id: string) =>
  void logActivity({ action_type: action, performed_by: request.auth.user_id, subject_user_id: request.auth.user_id, org_id: request.auth.org_id, new_value: { announcement_id: id } });

const COLS = sql`a.id::text, a.title, a.body, a.category, a.is_pinned, a.published_at::text AS published_at,
  a.expires_on::text AS expires_on, u.full_name AS author_name`;

export async function announcementsRouter(app: FastifyInstance) {
  const view = requireCapability(CAPABILITY.HR_EMPLOYEES_ANNOUNCEMENTS_VIEW);
  const manage = requireCapability(CAPABILITY.HR_EMPLOYEES_ANNOUNCEMENTS_MANAGE, 'You do not have permission to manage announcements');

  app.get('/announcements', { preHandler: [authenticate, view] }, async (request, reply) => {
    const ctx = ctxOf(request);
    const data = await withRoleTx(ctx, async (tx) =>
      tx.execute(sql`
        SELECT ${COLS}, (r.user_id IS NOT NULL) AS is_read
        FROM hr.announcements a
        LEFT JOIN iam.users u ON u.id = a.author_id
        LEFT JOIN hr.announcement_reads r ON r.announcement_id = a.id AND r.user_id = ${ctx.user_id}
        WHERE NOT a.is_deleted
        ORDER BY a.is_pinned DESC, a.published_at DESC LIMIT 50`),
    );
    return reply.send({ success: true, data });
  });

  app.post('/announcements/:id/read', { preHandler: [authenticate, view] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ctx = ctxOf(request);
    await withRoleTx(ctx, async (tx) => {
      // The SELECT is filtered by the announcements policy, so an unpublished or foreign id inserts nothing.
      const rows = (await tx.execute(sql`
        INSERT INTO hr.announcement_reads (announcement_id, user_id, org_id)
        SELECT a.id, ${ctx.user_id}, a.org_id FROM hr.announcements a WHERE a.id = ${id} AND NOT a.is_deleted
        ON CONFLICT (announcement_id, user_id) DO NOTHING
        RETURNING announcement_id::text`)) as unknown as unknown[];
      if (rows.length === 0) {
        const exists = (await tx.execute(sql`SELECT 1 FROM hr.announcements WHERE id = ${id} AND NOT is_deleted`)) as unknown as unknown[];
        if (exists.length === 0) throw new NotFoundError('Announcement not found');
      }
    });
    return reply.status(204).send();
  });

  // ── HR: all announcements including drafts ────────────────────────────────
  app.get('/announcements/admin', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const ctx = ctxOf(request);
    const data = await withServiceTx(async (tx) =>
      tx.execute(sql`
        SELECT ${COLS}, (SELECT count(*)::int FROM hr.announcement_reads r WHERE r.announcement_id = a.id) AS read_count
        FROM hr.announcements a LEFT JOIN iam.users u ON u.id = a.author_id
        WHERE a.org_id = ${ctx.org_id} AND NOT a.is_deleted
        ORDER BY a.created_at DESC LIMIT 100`),
    );
    return reply.send({ success: true, data });
  });

  app.post('/announcements', { preHandler: [authenticate, manage, validate({ body: createAnnouncementSchema })] }, async (request, reply) => {
    const ctx = ctxOf(request);
    const b = request.body as CreateAnnouncementInput;
    const id = await withServiceTx(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
      const rows = (await tx.execute(sql`
        INSERT INTO hr.announcements (org_id, author_id, title, body, category, is_pinned, expires_on, published_at, created_by)
        VALUES (${ctx.org_id}, ${ctx.user_id}, ${b.title}, ${b.body}, ${b.category}, ${b.is_pinned}, ${b.expires_on ?? null}::date,
                ${b.publish ? sql`CLOCK_TIMESTAMP()` : sql`NULL`}, ${ctx.user_id})
        RETURNING id::text`)) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    audit(request, b.publish ? 'announcement_published' : 'announcement_drafted', id);
    return reply.status(201).send({ success: true, data: { id } });
  });

  app.post('/announcements/:id/publish', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ctx = ctxOf(request);
    const rows = await withServiceTx(async (tx) =>
      (await tx.execute(sql`
        UPDATE hr.announcements SET published_at = COALESCE(published_at, CLOCK_TIMESTAMP())
        WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted RETURNING id::text`)) as unknown as unknown[]);
    if (rows.length === 0) throw new NotFoundError('Announcement not found');
    audit(request, 'announcement_published', id);
    return reply.status(204).send();
  });

  // Retire = soft delete; readers stop seeing it at once.
  app.post('/announcements/:id/retire', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ctx = ctxOf(request);
    const rows = await withServiceTx(async (tx) =>
      (await tx.execute(sql`
        UPDATE hr.announcements SET is_active = FALSE, is_deleted = TRUE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id}
        WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted RETURNING id::text`)) as unknown as unknown[]);
    if (rows.length === 0) throw new NotFoundError('Announcement not found');
    audit(request, 'announcement_retired', id);
    return reply.status(204).send();
  });
}
