import type { FastifyRequest, FastifyReply } from 'fastify';
import { canManageEmployees } from '@hr/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './employees.service.js';
import type {
  CreateEmployeeProfileInput,
  UpdateEmployeeProfileInput,
  ListEmployeeProfilesInput,
} from './employees.schema.js';

export class EmployeesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const filters = request.query as ListEmployeeProfilesInput;
    const result = await service.listEmployees({ org_id, user_id, role, tenant_id }, filters);
    return reply.send({ success: true, ...result });
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    const { userId } = request.params as { userId: string };
    const employee = await service.getEmployee({ org_id, user_id, role, tenant_id, rank }, userId);
    return reply.send({ success: true, data: employee });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (!canManageEmployees(role, rank)) throw new ForbiddenError('Only org admins or HR admins can create employee profiles');
    const data = request.body as CreateEmployeeProfileInput;
    const result = await service.createEmployee({ org_id, user_id, role, tenant_id }, data);
    return reply.status(201).send({ success: true, data: { user_id: result.userId } });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (!canManageEmployees(role, rank)) throw new ForbiddenError('Only org admins or HR admins can update employee profiles');
    const { userId } = request.params as { userId: string };
    const data = request.body as UpdateEmployeeProfileInput;
    await service.updateEmployee({ org_id, user_id, role, tenant_id }, userId, data);
    return reply.status(204).send();
  };

  listDepartments = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const departments = await service.listDepartments({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: departments });
  };

  createDepartment = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (!canManageEmployees(role, rank)) throw new ForbiddenError('Only org admins or HR admins can manage departments');
    const { name } = request.body as { name: string };
    const result = await service.createDepartment({ org_id, user_id, role, tenant_id }, name);
    return reply.status(201).send({ success: true, data: { id: result.id } });
  };

  updateDepartment = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (!canManageEmployees(role, rank)) throw new ForbiddenError('Only org admins or HR admins can manage departments');
    const { id } = request.params as { id: string };
    const data = request.body as { name?: string; is_active?: boolean };
    await service.updateDepartment({ org_id, user_id, role, tenant_id }, id, data);
    return reply.status(204).send();
  };

  listDesignations = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const designations = await service.listDesignations({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: designations });
  };

  createDesignation = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (!canManageEmployees(role, rank)) throw new ForbiddenError('Only org admins or HR admins can manage designations');
    const { name } = request.body as { name: string };
    const result = await service.createDesignation({ org_id, user_id, role, tenant_id }, name);
    return reply.status(201).send({ success: true, data: { id: result.id } });
  };

  updateDesignation = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (!canManageEmployees(role, rank)) throw new ForbiddenError('Only org admins or HR admins can manage designations');
    const { id } = request.params as { id: string };
    const data = request.body as { name?: string; is_active?: boolean };
    await service.updateDesignation({ org_id, user_id, role, tenant_id }, id, data);
    return reply.status(204).send();
  };
}
