import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { CAPABILITY } from '@platform/rbac';
import { EmployeesController } from './employees.controller.js';
import {
  createEmployeeProfileSchema,
  updateEmployeeProfileSchema,
  listEmployeeProfilesSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  createDesignationSchema,
  updateDesignationSchema,
} from './employees.schema.js';

const ctrl = new EmployeesController();

export async function employeesRouter(app: FastifyInstance) {
  app.get('/employees', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_VIEW), validate({ query: listEmployeeProfilesSchema })],
  }, ctrl.list);
  app.get('/employees/departments', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_VIEW)] }, ctrl.listDepartments);
  app.post('/employees/departments', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_TAXONOMY_MANAGE, 'You do not have permission to manage departments'), validate({ body: createDepartmentSchema })],
  }, ctrl.createDepartment);
  app.patch('/employees/departments/:id', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_TAXONOMY_MANAGE, 'You do not have permission to manage departments'), validate({ body: updateDepartmentSchema })],
  }, ctrl.updateDepartment);

  app.get('/employees/designations', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_VIEW)] }, ctrl.listDesignations);
  app.post('/employees/designations', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_TAXONOMY_MANAGE, 'You do not have permission to manage designations'), validate({ body: createDesignationSchema })],
  }, ctrl.createDesignation);
  app.patch('/employees/designations/:id', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_TAXONOMY_MANAGE, 'You do not have permission to manage designations'), validate({ body: updateDesignationSchema })],
  }, ctrl.updateDesignation);

  app.get('/employees/:userId', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_VIEW)] }, ctrl.getById);
  app.post('/employees', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_MANAGE, 'You do not have permission to create employee profiles'), validate({ body: createEmployeeProfileSchema })],
  }, ctrl.create);
  app.patch('/employees/:userId', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_MANAGE, 'You do not have permission to edit employee profiles'), validate({ body: updateEmployeeProfileSchema })],
  }, ctrl.update);
}
