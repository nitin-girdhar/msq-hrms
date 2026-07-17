import type { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './attendance.service.js';
import type { AttendanceCtx } from './attendance.repository.js';
import { getPhotoStorage, contentTypeForKey } from '../../../lib/storage/photo-storage.js';
import type {
  CheckInInput,
  CheckOutInput,
  AttendanceRulesAdminInput,
  CreateShiftInput,
  UpdateShiftInput,
  CreateShiftAssignmentInput,
  UpdateShiftAssignmentInput,
  CreateRegularizationInput,
  ApproveRegularizationInput,
  RejectRegularizationInput,
  ListRegularizationsInput,
  AttendanceMeQueryInput,
  AttendanceTeamQueryInput,
  ReportsSummaryQueryInput,
  FaceEnrollInput,
  FaceReviewsQueryInput,
} from '@crm/validation';

function ctxOf(request: FastifyRequest): AttendanceCtx {
  const { org_id, user_id, role, tenant_id, rank } = request.auth;
  return { org_id, user_id, role, tenant_id, rank };
}

function punchMeta(request: FastifyRequest) {
  return { ip: request.ip ?? null, userAgent: (request.headers['user-agent'] as string | undefined) ?? null };
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export class AttendanceController {
  // ── Punches ─────────────────────────────────────────────────────────────────
  checkIn = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.checkIn(ctxOf(request), request.body as CheckInInput, punchMeta(request));
    return reply.status(201).send({ success: true, data: result });
  };

  checkOut = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.checkOut(ctxOf(request), request.body as CheckOutInput, punchMeta(request));
    return reply.status(201).send({ success: true, data: result });
  };

  // ── Rules ───────────────────────────────────────────────────────────────────
  getRules = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getRules(ctxOf(request));
    return reply.send({ success: true, data });
  };

  updateRules = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.updateRules(ctxOf(request), request.body as AttendanceRulesAdminInput);
    return reply.send({ success: true, data });
  };

  // ── Me / Team ─────────────────────────────────────────────────────────────────
  me = async (request: FastifyRequest, reply: FastifyReply) => {
    const { month } = request.query as AttendanceMeQueryInput;
    const data = await service.getMyMonth(ctxOf(request), month ?? currentMonth());
    return reply.send({ success: true, data });
  };

  team = async (request: FastifyRequest, reply: FastifyReply) => {
    const { date } = request.query as AttendanceTeamQueryInput;
    const data = await service.getTeam(ctxOf(request), date ?? currentDate());
    return reply.send({ success: true, data });
  };

  // ── Photo (authenticated) ─────────────────────────────────────────────────────
  photo = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const key = await service.getPhotoKey(ctxOf(request), id);
    if (!key) return reply.status(404).send({ success: false, error: 'Photo not found' });
    const bytes = await getPhotoStorage().get(key);
    if (!bytes) return reply.status(404).send({ success: false, error: 'Photo not found' });
    return reply.header('Content-Type', contentTypeForKey(key)).header('Cache-Control', 'private, no-store').send(bytes);
  };

  // ── Shifts ──────────────────────────────────────────────────────────────────
  listShifts = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.listShifts(ctxOf(request));
    return reply.send({ success: true, data });
  };

  createShift = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createShift(ctxOf(request), request.body as CreateShiftInput);
    return reply.status(201).send({ success: true, data: result });
  };

  updateShift = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateShift(ctxOf(request), id, request.body as UpdateShiftInput);
    return reply.status(204).send();
  };

  // ── Shift assignments ─────────────────────────────────────────────────────────
  listShiftAssignments = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.query as { userId?: string };
    const data = await service.listShiftAssignments(ctxOf(request), userId);
    return reply.send({ success: true, data });
  };

  createShiftAssignment = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createShiftAssignment(ctxOf(request), request.body as CreateShiftAssignmentInput);
    return reply.status(201).send({ success: true, data: result });
  };

  updateShiftAssignment = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateShiftAssignment(ctxOf(request), id, request.body as UpdateShiftAssignmentInput);
    return reply.status(204).send();
  };

  // ── Regularizations ───────────────────────────────────────────────────────────
  createRegularization = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createRegularization(ctxOf(request), request.body as CreateRegularizationInput);
    return reply.status(201).send({ success: true, data: result });
  };

  listRegularizations = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.listRegularizations(ctxOf(request), request.query as ListRegularizationsInput);
    return reply.send({ success: true, ...result });
  };

  approveRegularization = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { comment } = request.body as ApproveRegularizationInput;
    const result = await service.approveRegularization(ctxOf(request), id, comment ?? null);
    return reply.send({ success: true, data: result });
  };

  rejectRegularization = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { comment } = request.body as RejectRegularizationInput;
    const result = await service.rejectRegularization(ctxOf(request), id, comment);
    return reply.send({ success: true, data: result });
  };

  // ── Face enrollment / status / reference photo ──────────────────────────────
  faceEnroll = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.enrollFace(ctxOf(request), request.body as FaceEnrollInput);
    return reply.status(201).send({ success: true, data: result });
  };

  faceStatus = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const data = await service.getFaceStatus(ctxOf(request), userId);
    return reply.send({ success: true, data });
  };

  faceDelete = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    await service.deleteFaceEnrollment(ctxOf(request), userId);
    return reply.status(204).send();
  };

  faceReference = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const key = await service.getReferencePhotoKey(ctxOf(request), userId);
    if (!key) return reply.status(404).send({ success: false, error: 'Reference photo not found' });
    const bytes = await getPhotoStorage().get(key);
    if (!bytes) return reply.status(404).send({ success: false, error: 'Reference photo not found' });
    return reply.header('Content-Type', contentTypeForKey(key)).header('Cache-Control', 'private, no-store').send(bytes);
  };

  // ── Face reviews (queue + clear/reject) ─────────────────────────────────────
  faceReviews = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.listFaceReviews(ctxOf(request), request.query as FaceReviewsQueryInput);
    return reply.send({ success: true, ...result });
  };

  faceReviewClear = async (request: FastifyRequest, reply: FastifyReply) => {
    const { eventId } = request.params as { eventId: string };
    const result = await service.clearFaceReview(ctxOf(request), eventId);
    return reply.send({ success: true, data: result });
  };

  faceReviewReject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { eventId } = request.params as { eventId: string };
    const result = await service.rejectFaceReview(ctxOf(request), eventId);
    return reply.send({ success: true, data: result });
  };

  // ── Reports (json / csv / xlsx) ─────────────────────────────────────────────
  reportsSummary = async (request: FastifyRequest, reply: FastifyReply) => {
    const { month, format } = request.query as ReportsSummaryQueryInput;
    const m = month ?? currentMonth();
    const rows = await service.monthlySummary(ctxOf(request), m);

    if (format === 'json') {
      return reply.send({ success: true, data: rows });
    }

    const columns: Array<{ key: string; header: string }> = [
      { key: 'user_full_name', header: 'Employee' },
      { key: 'user_email', header: 'Email' },
      { key: 'month', header: 'Month' },
      { key: 'present_count', header: 'Present' },
      { key: 'absent_count', header: 'Absent' },
      { key: 'half_day_count', header: 'Half Day' },
      { key: 'on_leave_count', header: 'On Leave' },
      { key: 'holiday_count', header: 'Holiday' },
      { key: 'weekly_off_count', header: 'Weekly Off' },
      { key: 'wfh_count', header: 'WFH' },
      { key: 'late_count', header: 'Late' },
      { key: 'early_exit_count', header: 'Early Exit' },
      { key: 'avg_worked_minutes', header: 'Avg Worked (min)' },
    ];

    if (format === 'csv') {
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        columns.map((c) => c.header).join(','),
        ...rows.map((r) => columns.map((c) => esc((r as Record<string, unknown>)[c.key])).join(',')),
      ];
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="attendance-${m}.csv"`)
        .send(lines.join('\n'));
    }

    // xlsx
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Attendance ${m}`);
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key }));
    for (const r of rows) ws.addRow(r as Record<string, unknown>);
    const buffer = await wb.xlsx.writeBuffer();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="attendance-${m}.xlsx"`)
      .send(Buffer.from(buffer));
  };
}
