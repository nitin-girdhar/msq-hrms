import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

// Service-to-service calls only (identity-service's team-member create/edit
// flow). Requires the shared internal secret — the same check leads-service's
// internal routes use.
//
// The secret alone is not enough: the api-gateway attaches that same secret to
// every request it proxies for a logged-in user. No gateway route points here,
// but a route that builds its upstream path from a path param could be steered
// here (`..%2Finternal%2F…`). The gateway always sets X-User-Id for a user's
// request and a service-to-service caller never does, so a call carrying one is
// refused.
export async function authenticateInternal(request: FastifyRequest): Promise<void> {
  const secret = request.headers['x-internal-secret'] as string | undefined;
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    throw new UnauthorizedError('Unauthorized');
  }
  if (request.headers['x-user-id'] !== undefined) {
    throw new UnauthorizedError('Unauthorized');
  }
}
