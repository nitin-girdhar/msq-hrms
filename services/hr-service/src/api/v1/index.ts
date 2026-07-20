import type { FastifyInstance } from 'fastify';
import { employeesRouter } from './employees/employees.router.js';
import { leaveRouter } from './leave/leave.router.js';
import { attendanceRouter } from './attendance/attendance.router.js';
import { modulesRouter } from './modules/modules.router.js';
// Tenant-scoped lookup/role admin (N-6): super_admin manages HR reference data
// within a selected tenant. Moved here from admin-service so the write executes
// in the schema-owning service under tenant RLS (never root_service).
import { leaveTypesRouter } from './leave-types/leave-types.router.js';
import { employmentTypesRouter } from './employment-types/employment-types.router.js';
import { attendanceStatusesRouter } from './attendance-statuses/attendance-statuses.router.js';
import { hrRolesRouter } from './hr-roles/hr-roles.router.js';

export async function v1Router(app: FastifyInstance) {
  await app.register(employeesRouter);
  await app.register(leaveRouter);
  await app.register(attendanceRouter);
  await app.register(modulesRouter);
  await app.register(leaveTypesRouter);
  await app.register(employmentTypesRouter);
  await app.register(attendanceStatusesRouter);
  await app.register(hrRolesRouter);
}
