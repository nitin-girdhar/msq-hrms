import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { requireCapability } from '../../../middleware/require-capability.middleware.js';
import { CAPABILITY } from '@platform/rbac';
import { SwapsController } from './swaps.controller.js';
import {
  createShiftSwapSchema,
  respondShiftSwapSchema,
  decideShiftSwapSchema,
  rejectShiftSwapSchema,
  rosterQuerySchema,
} from './swaps.schema.js';

const ctrl = new SwapsController();

export async function swapsRouter(app: FastifyInstance) {
  const request = requireCapability(CAPABILITY.HR_ATTENDANCE_SWAP_REQUEST, 'You do not have permission to request shift swaps');
  const approve = requireCapability(CAPABILITY.HR_ATTENDANCE_SWAP_APPROVE, 'You do not have permission to decide shift swaps');

  app.get('/attendance/roster', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_ATTENDANCE_ROSTER_VIEW), validate({ query: rosterQuerySchema })] }, ctrl.roster);
  app.get('/attendance/swaps', { preHandler: [authenticate, requireCapability(CAPABILITY.HR_ATTENDANCE_VIEW)] }, ctrl.listMine);
  app.get('/attendance/swaps/queue', { preHandler: [authenticate, approve] }, ctrl.queue);
  app.post('/attendance/swaps', { preHandler: [authenticate, request, validate({ body: createShiftSwapSchema })] }, ctrl.create);
  app.post('/attendance/swaps/:id/respond', { preHandler: [authenticate, request, validate({ body: respondShiftSwapSchema })] }, ctrl.respond);
  app.post('/attendance/swaps/:id/cancel', { preHandler: [authenticate, request] }, ctrl.cancel);
  app.post('/attendance/swaps/:id/approve', { preHandler: [authenticate, approve, validate({ body: decideShiftSwapSchema })] }, ctrl.approve);
  app.post('/attendance/swaps/:id/reject', { preHandler: [authenticate, approve, validate({ body: rejectShiftSwapSchema })] }, ctrl.reject);
}
