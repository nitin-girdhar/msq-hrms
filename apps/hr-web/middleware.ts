import { createProductMiddleware, productOrigins } from '@platform/ui-kit/middleware';

// HR product app (hr.app.com). Verifies the shared .app.com session cookie and
// bounces unauthenticated users to the auth origin, preserving the target URL.
// `selfOrigin` — see the note in lms-web's middleware.
export const middleware = createProductMiddleware({
  protectedPrefixes: ['/leave', '/attendance', '/api/'],
  selfOrigin: productOrigins().hr,
});

export const config = {
  matcher: ['/leave/:path*', '/attendance/:path*', '/api/:path*'],
};
