import type { FastifyInstance } from 'fastify';
import { employeesRouter } from './employees/employees.router.js';
import { profileRouter } from './profile/profile.router.js';
import { leaveRouter } from './leave/leave.router.js';
import { attendanceRouter } from './attendance/attendance.router.js';
import { modulesRouter } from './modules/modules.router.js';
import { meRouter } from './me/me.router.js';
import { internalRouter } from './internal/internal.router.js';
// Tenant-scoped lookup admin (N-6): super_admin manages HR reference data
// within a selected tenant. Moved here from admin-service so the write executes
// in the schema-owning service under tenant RLS (never root_service). hr-roles
// was a sibling here; removed along with hr.roles/hr.member_roles — role/rank
// resolution runs on the unified iam ladder now, see @platform/db's
// resolveGlobalRole.
import { leaveTypesRouter } from './leave-types/leave-types.router.js';
import { employmentTypesRouter } from './employment-types/employment-types.router.js';
import { attendanceStatusesRouter } from './attendance-statuses/attendance-statuses.router.js';
import { leaveRequestStatusesRouter } from './leave-request-statuses/leave-request-statuses.router.js';
import { designationsRouter } from './designations/designations.router.js';
import { holidayCalendarsRouter } from './holiday-calendars/holiday-calendars.router.js';
import { holidaysRouter } from './holidays/holidays.router.js';
import { shiftsRouter } from './shifts/shifts.router.js';

export async function v1Router(app: FastifyInstance) {
  await app.register(employeesRouter);
  await app.register(profileRouter);
  await app.register(leaveRouter);
  await app.register(attendanceRouter);
  await app.register(modulesRouter);
  await app.register(meRouter);
  await app.register(internalRouter);
  await app.register(leaveTypesRouter);
  await app.register(employmentTypesRouter);
  await app.register(attendanceStatusesRouter);
  await app.register(leaveRequestStatusesRouter);
  await app.register(designationsRouter);
  await app.register(holidayCalendarsRouter);
  await app.register(holidaysRouter);
  await app.register(shiftsRouter);
}
