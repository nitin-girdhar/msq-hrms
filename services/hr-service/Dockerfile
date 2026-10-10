# Self-contained image built from a `pnpm deploy` output.
# See docs/Platform_Architecture_Decisions.md (D5) and scripts/docker-ship.sh /
# scripts/docker-load.md for how to ship and run this image.
# Build from the repo root: `docker build -f services/hr-service/Dockerfile .`
#
# Debian (glibc), not Alpine: the in-process face engine uses onnxruntime-node,
# which ships glibc-only native binaries. Builder and runner must share the libc
# because the runner copies node_modules (native .node files) from the builder.
# The ONNX models travel inside /app/models via package.json "files".
FROM node:20-bookworm-slim AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @crm/hr-service... build
RUN pnpm --filter @crm/hr-service deploy --prod /app

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# onnxruntime-node (>= 1.30) starts a telemetry system that tries to upload over
# HTTPS. A service holding biometric data must not phone home: switch it off.
# Read by the native library at load, so it has to be in the process env.
ENV ORT_DISABLE_TELEMETRY=1
COPY --from=builder /app /app
EXPOSE 4007
CMD ["node", "dist/server.js"]
