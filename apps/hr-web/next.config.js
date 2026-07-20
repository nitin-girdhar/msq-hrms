// hr.app.com — leave + attendance. Transpiles the shared ui-kit and the HR
// feature package (TypeScript source, no build step) and proxies /api/* to the
// shared gateway.
//
// Plain .js (not .ts): `next start` re-reads this file at runtime, which
// requires the `typescript` package to be present — but production images
// are deployed with `pnpm deploy --prod`, which excludes devDependencies.
/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@platform/ui-kit', '@hr/web'],
  async rewrites() {
    const apiGateway = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiGateway}/:path*` }];
  },
};

module.exports = config;
