import type { FastifyRequest, FastifyReply } from 'fastify';
import { can, CAPABILITY } from '@platform/rbac';
import * as service from './attendance.service.js';
import type { AttendanceCtx } from './attendance.repository.js';
import { getPhotoStorage, contentTypeForKey } from '../../../lib/storage/photo-storage.js';
import { SUMMARY_COLUMNS, numericSummaryRows, toCsv, detailCsv, detailXlsx } from '../../../lib/attendance/report-export.js';
import type {
  CheckInInput,
  CheckOutInput,
  AttendanceRulesAdminInput,
  CreateShiftInput,
  UpdateShiftInput,
  CreateShiftAssignmentInput,
  UpdateShiftAssignmentInput,
  CreateGeoExceptionInput,
  UpdateGeoExceptionInput,
  ListGeoExceptionsInput,
  RecomputeAttendanceInput,
  CreateRegularizationInput,
  UpdateRegularizationInput,
  ApproveRegularizationInput,
  RejectRegularizationInput,
  ListRegularizationsInput,
  AttendanceMeQueryInput,
  AttendanceTeamQueryInput,
  DayEventsQueryInput,
  ReportsSummaryQueryInput,
  ReportsDetailQueryInput,
  FaceEnrollInput,
  FaceReviewsQueryInput,
} from '@hr/validation';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function ctxOf(request: FastifyRequest): AttendanceCtx {
  const { org_id, user_id, role, tenant_id, rank, capabilities } = request.auth;
  // Tier C3 defence-in-depth: a role without platform.write runs its whole
  // transaction as readonly_user with transaction_read_only = on, so a missed
  // app-layer check still cannot write. Previously LMS-only and keyed on rank 0.
  const readOnly = !can(request.auth, CAPABILITY.PLATFORM_WRITE);
  return { org_id, user_id, role, tenant_id, rank, capabilities, readOnly };
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

  getAdminRules = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getAdminRules(ctxOf(request));
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

  todayState = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getTodayPunchState(ctxOf(request));
    return reply.send({ success: true, data });
  };

  team = async (request: FastifyRequest, reply: FastifyReply) => {
    const { date } = request.query as AttendanceTeamQueryInput;
    const data = await service.getTeam(ctxOf(request), date ?? currentDate());
    return reply.send({ success: true, data });
  };

  todaySummary = async (request: FastifyRequest, reply: FastifyReply) => {
    const { date } = request.query as AttendanceTeamQueryInput;
    const data = await service.getTodaySummary(ctxOf(request), date ?? currentDate());
    return reply.send({ success: true, data });
  };

  dayEvents = async (request: FastifyRequest, reply: FastifyReply) => {
    const { user_id, date } = request.query as DayEventsQueryInput;
    const data = await service.listDayEvents(ctxOf(request), user_id, date);
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

  listGeoExceptions = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.listGeoExceptions(ctxOf(request), request.query as ListGeoExceptionsInput);
    return reply.send({ success: true, data });
  };

  createGeoException = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createGeoException(ctxOf(request), request.body as CreateGeoExceptionInput);
    return reply.status(201).send({ success: true, data: result });
  };

  updateGeoException = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateGeoException(ctxOf(request), id, request.body as UpdateGeoExceptionInput);
    return reply.status(204).send();
  };

  recomputeAttendance = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.recomputeAttendance(ctxOf(request), request.body as RecomputeAttendanceInput);
    return reply.send({ success: true, data: result });
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

  getRegularization = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const result = await service.getOwnRegularizationDetail(ctxOf(request), id);
    return reply.send({ success: true, data: result });
  };

  updateRegularization = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateRegularization(ctxOf(request), id, request.body as UpdateRegularizationInput);
    return reply.send({ success: true, data: { id } });
  };

  cancelRegularization = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.cancelRegularization(ctxOf(request), id);
    return reply.send({ success: true, data: { id } });
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

  // Self-service enrollment context for the photo-upload modal (own user only).
  faceSelf = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getSelfFaceContext(ctxOf(request));
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

    const rowsOut = numericSummaryRows(rows as Array<Record<string, unknown>>);
    if (format === 'csv') {
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="attendance-${m}.csv"`)
        .send(toCsv(SUMMARY_COLUMNS, rowsOut));
    }

    // xlsx (exceljs security note: lib/attendance/report-export.ts)
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Attendance ${m}`);
    ws.columns = SUMMARY_COLUMNS.map((c) => ({ header: c.header, key: c.key }));
    for (const r of rowsOut) ws.addRow(r);
    const buffer = await wb.xlsx.writeBuffer();
    return reply
      .header('Content-Type', XLSX_TYPE)
      .header('Content-Disposition', `attachment; filename="attendance-${m}.xlsx"`)
      .send(Buffer.from(buffer));
  };

  reportsDetail = async (request: FastifyRequest, reply: FastifyReply) => {
    const { month, format } = request.query as ReportsDetailQueryInput;
    const m = month ?? currentMonth();
    const { summary, report } = await service.detailReport(ctxOf(request), m);

    if (format === 'csv') {
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="attendance-detail-${m}.csv"`)
        .send(detailCsv(report));
    }
    const buffer = await detailXlsx(m, summary as Array<Record<string, unknown>>, report);
    return reply
      .header('Content-Type', XLSX_TYPE)
      .header('Content-Disposition', `attachment; filename="attendance-detail-${m}.xlsx"`)
      .send(buffer);
  };
}
