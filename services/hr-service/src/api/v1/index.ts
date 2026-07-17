import type { FastifyInstance } from 'fastify';
import { employeesRouter } from './employees/employees.router.js';
import { leaveRouter } from './leave/leave.router.js';
import { attendanceRouter } from './attendance/attendance.router.js';
import { modulesRouter } from './modules/modules.router.js';

export async function v1Router(app: FastifyInstance) {
  await app.register(employeesRouter);
  await app.register(leaveRouter);
  await app.register(attendanceRouter);
  await app.register(modulesRouter);
}
