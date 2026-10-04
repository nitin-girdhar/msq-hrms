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

  app.get('/employees/:userId/profile-360', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_PROFILE360_VIEW, 'You do not have permission to open employee profiles')],
  }, ctrl.get360);
  app.post('/employees/:userId/notes', {
    preHandler: [authenticate, requireCapability(CAPABILITY.HR_EMPLOYEES_NOTES_MANAGE, 'You do not have permission to add HR notes'), validate({ body: createEmployeeNoteSchema })],
  }, ctrl.addNote);
}
