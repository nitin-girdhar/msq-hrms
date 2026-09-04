import { createProductMiddleware, productOrigins } from '@platform/ui-kit/middleware';

// HR product app, served at /hrms under the shared host. Verifies the shared
// session cookie and bounces unauthenticated users to the auth app, preserving
// the target URL. `selfOrigin` — see the note in lms-web's middleware.
export const middleware = createProductMiddleware({
  protectedPrefixes: ['/leave', '/attendance', '/api/'],
  selfOrigin: productOrigins().hr,
});

// `config.matcher` below is deliberately APP-RELATIVE. Next prepends this app's
// `basePath` to every matcher at build time, so writing the prefix here would
// produce a doubled `/hrms/hrms/...` that matches nothing — leaving these routes
// unauthenticated. Same for `protectedPrefixes`: `request.nextUrl.pathname`
// reaches middleware with the prefix already stripped. See the long note on
// DEFAULT_PROTECTED in @platform/ui-kit/middleware for the empirical evidence.
export const config = {
  matcher: ['/leave/:path*', '/attendance/:path*', '/api/:path*'],
};
