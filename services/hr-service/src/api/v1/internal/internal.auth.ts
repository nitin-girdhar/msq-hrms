import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

// Service-to-service calls only (identity-service's team-member create/edit
// flow). Requires the shared internal secret — the same check leads-service's
// internal routes use. These routes are NOT proxied by the api-gateway, so a
// browser can never reach them; the secret is the second fence.
export async function authenticateInternal(request: FastifyRequest): Promise<void> {
  const secret = request.headers['x-internal-secret'] as string | undefined;
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    throw new UnauthorizedError('Unauthorized');
  }
}
