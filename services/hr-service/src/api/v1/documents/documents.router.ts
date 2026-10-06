import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import { blobKeys } from '@platform/blob-storage';
import { assertOwnKey, getPhotoStorage } from '../../../lib/storage/photo-storage.js';
import { sniffDocument } from '../../../lib/documents/sniff.js';
import { documentLimitFor } from '../../../lib/documents/limit.js';
import { buildZip, uniqueNames } from '../../../lib/documents/zip.js';
import {
  uploadDocumentSchema,
  reviewDocumentSchema,
  documentSettingsSchema,
  DOCUMENT_DEFAULT_BYTES,
  type UploadDocumentInput,
  type ReviewDocumentInput,
  type DocumentSettingsInput,
} from '@hr/validation';

// Documents & compliance vault (schema 1.65.0). Identity paperwork: no org-wide policy, so
// EVERY read and write runs in the service transaction. Scoping is in SQL: "mine" is pinned to
// request.auth.user_id, everything else is fenced to request.auth.org_id and behind
// hr.employees.documents.manage. The audit log records THAT a file was opened, never its content.
const MAX_PER_PERSON = 100;

const audit = (request: FastifyRequest, action: string, subject: string, documentId: string, extra?: Record<string, unknown>) =>
  void logActivity({
    action_type: action,
    performed_by: request.auth.user_id,
    subject_user_id: subject,
    org_id: request.auth.org_id,
    new_value: { document_id: documentId, ...(extra ?? {}) },
  });

const COLUMNS = sql`
  d.id::text, d.user_id::text, d.category, d.title, d.file_name, d.mime_type, d.size_bytes, d.status,
  d.review_note, d.reviewed_at::text AS reviewed_at, d.expires_on::text AS expires_on,
  d.tax_section, d.amount::float8 AS amount, d.created_at::text AS created_at`;

type DocRow = { id: string; user_id: string; file_key: string; file_name: string; mime_type: string; status: string };

export async function documentsRouter(app: FastifyInstance) {
  const view = requireCapability(CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW);
  const manage = requireCapability(CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE, 'You do not have permission to review documents');

  // The upload limit the caller's branch allows. Anyone who can use the vault may read it (the upload form shows it).
  app.get('/documents/settings', { preHandler: [authenticate] }, async (request, reply) => {
    if (!can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW) && !can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE)) {
      throw new ForbiddenError('You do not have permission to use documents');
    }
    return reply.send({ success: true, data: { max_bytes: await documentLimitFor(request.auth.org_id) } });
  });

  app.put('/documents/settings', { preHandler: [authenticate, manage, validate({ body: documentSettingsSchema })] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const { max_bytes } = request.body as DocumentSettingsInput;
    await withServiceTx(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${user_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${org_id}, true)`);
      const upd = (await tx.execute(sql`
        UPDATE hr.document_settings SET max_bytes = ${max_bytes} WHERE org_id = ${org_id} AND NOT is_deleted RETURNING 1`)) as unknown as unknown[];
      if (upd.length === 0) {
        await tx.execute(sql`INSERT INTO hr.document_settings (org_id, max_bytes, created_by) VALUES (${org_id}, ${max_bytes}, ${user_id})`);
      }
    });
    void logActivity({ action_type: 'document_limit_set', performed_by: user_id, subject_user_id: user_id, org_id, new_value: { max_bytes } });
    return reply.status(204).send();
  });

  // Own documents. The id comes from request.auth, never from the request.
  app.get('/documents/mine', { preHandler: [authenticate, view] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const data = await withServiceTx(async (tx) =>
      tx.execute(sql`
        SELECT ${COLUMNS} FROM hr.employee_documents d
        WHERE d.user_id = ${user_id} AND d.org_id = ${org_id} AND NOT d.is_deleted
        ORDER BY d.created_at DESC LIMIT 200`),
    );
    return reply.send({ success: true, data });
  });

  app.post('/documents/mine', { preHandler: [authenticate, view, validate({ body: uploadDocumentSchema })] }, async (request, reply) => {
    const { org_id, user_id, tenant_id } = request.auth;
    const b = request.body as UploadDocumentInput;
    const bytes = Buffer.from(b.data_base64, 'base64');
    if (bytes.length === 0) throw new BadRequestError('That file is empty');
    const limit = await documentLimitFor(org_id);
    if (bytes.length > limit) throw new BadRequestError(`That file is over the ${(limit / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB limit`);
    // The type comes from the bytes, not the client's say-so: only PDF and common images are kept.
    const kind = sniffDocument(bytes);
    if (!kind) throw new BadRequestError('Only PDF, JPG, PNG or WebP files can be uploaded');

    // <tenant>/<branch>/<employee>/documents/<uuid>.<ext>; the DB column stays authoritative.
    const key = blobKeys.document(tenant_id, org_id, user_id, randomUUID(), kind.ext);
    const storage = getPhotoStorage();
    await storage.putAt(key, bytes);
    try {
      const id = await withServiceTx(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${user_id}, true)`);
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${org_id}, true)`);
        const n = (await tx.execute(sql`
          SELECT count(*)::int AS n FROM hr.employee_documents WHERE user_id = ${user_id} AND org_id = ${org_id} AND NOT is_deleted`)) as unknown as Array<{ n: number }>;
        if ((n[0]?.n ?? 0) >= MAX_PER_PERSON) throw new ConflictError('You have reached the document limit; remove one first');
        const rows = (await tx.execute(sql`
          INSERT INTO hr.employee_documents
            (org_id, user_id, category, title, file_key, file_name, mime_type, size_bytes, expires_on, tax_section, amount, created_by)
          VALUES (${org_id}, ${user_id}, ${b.category}, ${b.title}, ${key}, ${b.file_name}, ${kind.mime}, ${bytes.length},
                  ${b.expires_on ?? null}, ${b.category === 'tax_proof' ? (b.tax_section ?? null) : null},
                  ${b.category === 'tax_proof' ? (b.amount ?? null) : null}, ${user_id})
          RETURNING id::text`)) as unknown as Array<{ id: string }>;
        return rows[0]!.id;
      });
      audit(request, 'document_uploaded', user_id, id, { category: b.category });
      return reply.status(201).send({ success: true, data: { id } });
    } catch (err) {
      await storage.delete(key).catch(() => undefined); // no orphan blob if the row was refused
      throw err;
    }
  });

  // HR: someone's documents. Every read of another person's list is audited.
  app.get('/documents/employee/:userId', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const { org_id } = request.auth;
    const { userId } = request.params as { userId: string };
    const data = await withServiceTx(async (tx) =>
      tx.execute(sql`
        SELECT ${COLUMNS} FROM hr.employee_documents d
        WHERE d.user_id = ${userId} AND d.org_id = ${org_id} AND NOT d.is_deleted
        ORDER BY d.created_at DESC LIMIT 200`),
    );
    audit(request, 'documents_listed', userId, userId);
    return reply.send({ success: true, data });
  });

  // The whole folder as one ZIP ("dossier"): verified and pending files, not rejected ones. The size is
  // capped so one request cannot pull the blob store into memory. HR's download of someone else's is audited.
  const DOSSIER_MAX_BYTES = 25 * 1024 * 1024;
  const sendDossier = async (request: FastifyRequest, reply: FastifyReply, subjectId: string, own: boolean) => {
    const { org_id, tenant_id } = request.auth;
    const { name, rows } = await withServiceTx(async (tx) => {
      const who = (await tx.execute(sql`
        SELECT u.full_name FROM iam.users u JOIN hr.employee_profiles p ON p.user_id = u.id
        WHERE u.id = ${subjectId} AND p.org_id = ${org_id} LIMIT 1`)) as unknown as Array<{ full_name: string }>;
      const docs = (await tx.execute(sql`
        SELECT d.title, d.category, d.file_key, d.file_name, d.size_bytes, d.created_at::text AS created_at
        FROM hr.employee_documents d
        WHERE d.user_id = ${subjectId} AND d.org_id = ${org_id} AND NOT d.is_deleted AND d.status <> 'rejected'
        ORDER BY d.category, d.created_at`)) as unknown as Array<{ title: string; category: string; file_key: string; file_name: string; size_bytes: number; created_at: string }>;
      return { name: who[0]?.full_name, rows: docs };
    });
    if (!name) throw new NotFoundError('Employee not found');
    if (rows.length === 0) throw new NotFoundError('There are no documents to download');
    if (rows.reduce((t, r) => t + r.size_bytes, 0) > DOSSIER_MAX_BYTES) throw new BadRequestError('The folder is too large to download at once; open the files one by one');
    const storage = getPhotoStorage();
    const files: Array<{ row: (typeof rows)[number]; data: Buffer }> = [];
    for (const r of rows) {
      assertOwnKey(tenant_id, r.file_key);
      const data = await storage.get(r.file_key);
      if (data) files.push({ row: r, data });
    }
    if (files.length === 0) throw new NotFoundError('There are no documents to download');
    const names = uniqueNames(files.map(({ row }) => `${row.category}_${row.title}${row.file_name.includes('.') ? row.file_name.slice(row.file_name.lastIndexOf('.')) : ''}`));
    const zip = buildZip(files.map(({ row, data }, i) => ({ name: names[i]!, data, date: new Date(row.created_at) })));
    if (!own) audit(request, 'document_dossier_downloaded', subjectId, subjectId, { count: files.length });
    const safe = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'documents';
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${safe}_documents.zip"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(zip);
  };

  app.get('/documents/mine/dossier', { preHandler: [authenticate, view] }, async (request, reply) =>
    sendDossier(request, reply, request.auth.user_id, true));

  app.get('/documents/employee/:userId/dossier', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    return sendDossier(request, reply, userId, false);
  });

  // HR: what is waiting for review, oldest first.
  app.get('/documents/admin/pending', { preHandler: [authenticate, manage] }, async (request, reply) => {
    const { org_id } = request.auth;
    const data = await withServiceTx(async (tx) =>
      tx.execute(sql`
        SELECT ${COLUMNS}, u.full_name AS user_full_name
        FROM hr.employee_documents d JOIN iam.users u ON u.id = d.user_id
        WHERE d.org_id = ${org_id} AND d.status = 'pending' AND NOT d.is_deleted
        ORDER BY d.created_at LIMIT 200`),
    );
    return reply.send({ success: true, data });
  });

  // The file itself. Owner (documents.view) or HR (documents.manage) in the same org; a
  // document that is not yours and not reviewable by you does not exist as far as you can tell.
  app.get('/documents/:id/file', { preHandler: [authenticate] }, async (request, reply) => {
    const { org_id, user_id, tenant_id } = request.auth;
    const { id } = request.params as { id: string };
    const row = await withServiceTx(async (tx) => {
      const r = (await tx.execute(sql`
        SELECT id::text, user_id::text, file_key, file_name, mime_type, status FROM hr.employee_documents
        WHERE id = ${id} AND org_id = ${org_id} AND NOT is_deleted`)) as unknown as Array<DocRow>;
      return r[0];
    });
    const mine = row?.user_id === user_id;
    const allowed = row && (mine ? can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW) || can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE) : can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE));
    if (!row || !allowed) throw new NotFoundError('Document not found');
    assertOwnKey(tenant_id, row.file_key);
    const bytes = await getPhotoStorage().get(row.file_key);
    if (!bytes) throw new NotFoundError('Document not found');
    if (!mine) audit(request, 'document_opened', row.user_id, row.id);
    const safeName = row.file_name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';
    return reply
      .header('Content-Type', row.mime_type)
      .header('Content-Disposition', `inline; filename="${safeName}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(bytes);
  });

  app.post('/documents/:id/review', { preHandler: [authenticate, manage, validate({ body: reviewDocumentSchema })] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const { id } = request.params as { id: string };
    const b = request.body as ReviewDocumentInput;
    const owner = await withServiceTx(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${user_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${org_id}, true)`);
      const r = (await tx.execute(sql`
        SELECT user_id::text, status FROM hr.employee_documents
        WHERE id = ${id} AND org_id = ${org_id} AND NOT is_deleted FOR UPDATE`)) as unknown as Array<{ user_id: string; status: string }>;
      const row = r[0];
      if (!row) throw new NotFoundError('Document not found');
      // Nobody signs off their own paperwork.
      if (row.user_id === user_id) throw new ForbiddenError('You cannot review your own document');
      if (row.status !== 'pending') throw new ConflictError('That document has already been reviewed');
      await tx.execute(sql`
        UPDATE hr.employee_documents
        SET status = ${b.decision}, reviewed_by = ${user_id}, reviewed_at = CLOCK_TIMESTAMP(), review_note = ${b.note ?? null}
        WHERE id = ${id}`);
      return row.user_id;
    });
    audit(request, b.decision === 'verified' ? 'document_verified' : 'document_rejected', owner, id);
    return reply.status(204).send();
  });

  // Remove a document: the owner while it is not verified, HR any time. A soft delete by UPDATE
  // (the DELETE trigger is only honoured for root_service), and the file itself is erased.
  app.delete('/documents/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { org_id, user_id, tenant_id } = request.auth;
    const { id } = request.params as { id: string };
    const isHr = can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE);
    const isOwnerCap = can(request.auth, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW);
    if (!isHr && !isOwnerCap) throw new ForbiddenError('You do not have permission to remove documents');
    const row = await withServiceTx(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${user_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${org_id}, true)`);
      const r = (await tx.execute(sql`
        SELECT id::text, user_id::text, file_key, status FROM hr.employee_documents
        WHERE id = ${id} AND org_id = ${org_id} AND NOT is_deleted FOR UPDATE`)) as unknown as Array<{ id: string; user_id: string; file_key: string; status: string }>;
      const d = r[0];
      if (!d || (d.user_id !== user_id && !isHr)) throw new NotFoundError('Document not found');
      if (!isHr && d.status === 'verified') throw new ConflictError('A verified document can only be removed by HR');
      await tx.execute(sql`
        UPDATE hr.employee_documents SET is_active = FALSE, is_deleted = TRUE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${user_id}
        WHERE id = ${id}`);
      return d;
    });
    assertOwnKey(tenant_id, row.file_key);
    await getPhotoStorage().delete(row.file_key).catch(() => undefined);
    audit(request, 'document_removed', row.user_id, row.id);
    return reply.status(204).send();
  });
}
