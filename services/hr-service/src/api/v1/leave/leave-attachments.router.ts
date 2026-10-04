import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY } from '@platform/rbac';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { BadRequestError, NotFoundError } from '../../../lib/errors.js';
import { getPhotoStorage } from '../../../lib/storage/photo-storage.js';
import { sniffDocument } from '../../../lib/documents/sniff.js';
import { documentLimitFor } from '../../../lib/documents/limit.js';
import { uploadLeaveAttachmentSchema, type UploadLeaveAttachmentInput } from '@hr/validation';

// Supporting documents for leave requests (schema 1.67.0). The bytes live in the shared blob store under
// leave/<org>/<user>/..., so a key is bound to the person who uploaded it; the request stores only the
// key and metadata. Identity always comes from request.auth.
export async function leaveAttachmentsRouter(app: FastifyInstance) {
  // Upload first, then send the returned token with the leave request. A file that is never attached
  // stays in the store until a cleanup sweep removes it.
  app.post('/leave/attachments', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_LEAVE_REQUEST_CREATE), validate({ body: uploadLeaveAttachmentSchema })] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const b = request.body as UploadLeaveAttachmentInput;
    const bytes = Buffer.from(b.data_base64, 'base64');
    if (bytes.length === 0) throw new BadRequestError('That file is empty');
    const limit = await documentLimitFor(org_id);
    if (bytes.length > limit) throw new BadRequestError(`That file is over the ${(limit / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB limit`);
    // The type comes from the bytes, never the client's name or content-type.
    const kind = sniffDocument(bytes);
    if (!kind) throw new BadRequestError('Only PDF, JPG, PNG or WebP files can be attached');
    const key = `leave/${org_id}/${user_id}/${randomUUID()}.${kind.ext}`;
    await getPhotoStorage().putAt(key, bytes);
    return reply.status(201).send({ success: true, data: { token: key, name: b.file_name, mime: kind.mime, size: bytes.length } });
  });

  // The file on a request: the requester, an approver on its chain, or someone who may see the branch's leave.
  app.get('/leave/requests/:id/attachment', { preHandler: [authenticate] }, async (request, reply) => {
    const { org_id, user_id } = request.auth;
    const { id } = request.params as { id: string };
    const row = await withServiceTx(async (tx) => {
      const r = (await tx.execute(sql`
        SELECT lr.user_id::text AS user_id, lr.attachment_key, lr.attachment_name, lr.attachment_mime,
               EXISTS (SELECT 1 FROM hr.leave_request_approvals a WHERE a.leave_request_id = lr.id AND a.approver_id = ${user_id}) AS is_approver
        FROM hr.leave_requests lr
        WHERE lr.id = ${id} AND lr.org_id = ${org_id} AND NOT lr.is_deleted`)) as unknown as Array<{
        user_id: string; attachment_key: string | null; attachment_name: string | null; attachment_mime: string | null; is_approver: boolean;
      }>;
      return r[0];
    });
    const mine = row?.user_id === user_id;
    const allowed = row && (mine || row.is_approver || can(request.auth, CAPABILITY.HR_LEAVE_VIEW_ORG) || can(request.auth, CAPABILITY.HR_LEAVE_VIEW_TENANT));
    if (!row || !allowed || !row.attachment_key) throw new NotFoundError('Attachment not found');
    const bytes = await getPhotoStorage().get(row.attachment_key);
    if (!bytes) throw new NotFoundError('Attachment not found');
    if (!mine) void logActivity({ action_type: 'leave_attachment_opened', performed_by: user_id, subject_user_id: row.user_id, org_id, new_value: { leave_request_id: id } });
    const safe = (row.attachment_name ?? 'attachment').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'attachment';
    return reply
      .header('Content-Type', row.attachment_mime ?? 'application/octet-stream')
      .header('Content-Disposition', `inline; filename="${safe}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(bytes);
  });
}
