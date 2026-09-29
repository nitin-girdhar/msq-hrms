// hr-web — leave + attendance, served at /hrms under the shared host.
// Transpiles the shared ui-kit and the HR feature package (TypeScript source,
// no build step) and proxies /api/* to the shared gateway.
//
// Plain .js (not .ts): `next start` re-reads this file at runtime, which
// requires the `typescript` package to be present — but production images
// are deployed with `pnpm deploy --prod`, which excludes devDependencies.
/** @type {import('next').NextConfig} */
const config = {
  // Single-origin topology — see the note in lms-web/next.config.js. Compiled
  // into the image; must match HR_URL (`http://app.localhost/hrms`) and the
  // `handle /hrms/*` block in infra/Caddyfile.
  basePath: '/hrms',
  transpilePackages: ['@platform/ui-kit', '@hr/web'],
  async rewrites() {
    const apiGateway = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';
    // `source` is auto-prefixed to /hrms/api/:path*; the absolute `destination`
    // is left un-prefixed, so the gateway sees /leave/balance. See the fuller
    // note in lms-web/next.config.js.
    return [{ source: '/api/:path*', destination: `${apiGateway}/:path*` }];
  },
};

module.exports = config;
