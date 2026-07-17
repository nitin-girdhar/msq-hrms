import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
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
    preHandler: [authenticate, validate({ query: listEmployeeProfilesSchema })],
  }, ctrl.list);
  app.get('/employees/departments', { preHandler: [authenticate] }, ctrl.listDepartments);
  app.post('/employees/departments', {
    preHandler: [authenticate, validate({ body: createDepartmentSchema })],
  }, ctrl.createDepartment);
  app.patch('/employees/departments/:id', {
    preHandler: [authenticate, validate({ body: updateDepartmentSchema })],
  }, ctrl.updateDepartment);

  app.get('/employees/designations', { preHandler: [authenticate] }, ctrl.listDesignations);
  app.post('/employees/designations', {
    preHandler: [authenticate, validate({ body: createDesignationSchema })],
  }, ctrl.createDesignation);
  app.patch('/employees/designations/:id', {
    preHandler: [authenticate, validate({ body: updateDesignationSchema })],
  }, ctrl.updateDesignation);

  app.get('/employees/:userId', { preHandler: [authenticate] }, ctrl.getById);
  app.post('/employees', {
    preHandler: [authenticate, validate({ body: createEmployeeProfileSchema })],
  }, ctrl.create);
  app.patch('/employees/:userId', {
    preHandler: [authenticate, validate({ body: updateEmployeeProfileSchema })],
  }, ctrl.update);
}
