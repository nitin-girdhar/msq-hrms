import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { CAPABILITY } from '@platform/rbac';
import { ProfileController } from './profile.controller.js';
import {
  upsertPersonalSchema,
  createEmergencyContactSchema,
  updateEmergencyContactSchema,
  createEmployeeNoteSchema,
} from './profile.schema.js';

const ctrl = new ProfileController();

// My profile (self) and Employee 360 (HR). The `me` routes take no user id: they are
// always about the verified caller, and the database's self policy repeats that.
export async function profileRouter(app: FastifyInstance) {
  const edit = requireCapability(CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT, 'You do not have permission to edit your profile');

  app.get('/profile/me', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT)] }, ctrl.getMine);
  app.put('/profile/me/personal', { preHandler: [authenticate, edit, validate({ body: upsertPersonalSchema })] }, ctrl.savePersonal);
  app.post('/profile/me/contacts', { preHandler: [authenticate, edit, validate({ body: createEmergencyContactSchema })] }, ctrl.addContact);
  app.patch('/profile/me/contacts/:id', { preHandler: [authenticate, edit, validate({ body: updateEmergencyContactSchema })] }, ctrl.updateContact);
  app.delete('/profile/me/contacts/:id', { preHandler: [authenticate, edit] }, ctrl.removeContact);

  // HR editing another person's personal details from Admin -> Team -> Edit. Service transaction in the
  // repository (the tables keep only a self policy), org-fenced, capability proved here.
  const manage = requireCapability(CAPABILITY.HR_EMPLOYEES_MANAGE, 'You do not have permission to edit employee details');
  app.get('/employees/:userId/personal', { preHandler: [authenticate, manage] }, ctrl.getPersonalFor);
  app.put('/employees/:userId/personal', { preHandler: [authenticate, manage, validate({ body: upsertPersonalSchema })] }, ctrl.savePersonalFor);
  app.post('/employees/:userId/contacts', { preHandler: [authenticate, manage, validate({ body: createEmergencyContactSchema })] }, ctrl.addContactFor);
  app.patch('/employees/:userId/contacts/:id', { preHandler: [authenticate, manage, validate({ body: updateEmergencyContactSchema })] }, ctrl.updateContactFor);
  app.delete('/employees/:userId/contacts/:id', { preHandler: [authenticate, manage] }, ctrl.removeContactFor);

  app.get('/employees/:userId/profile-360', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW, 'You do not have permission to open employee profiles')],
  }, ctrl.get360);
  app.post('/employees/:userId/notes', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_NOTES_MANAGE, 'You do not have permission to add HR notes'), validate({ body: createEmployeeNoteSchema })],
  }, ctrl.addNote);
}
