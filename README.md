# msq-hrms — HR Management System (HRMS)

Extracted from the `msq-platforms` monorepo per `docs/Phase5_Extraction_Plan.md`
(§2c). Owns: `hr-service`, `hr-web`, the `@hr/*` packages, and the `hr` DB
schema.

**Depends on `@platform/*` from `msq-core`** — clone this repo as a
`msq-hrms/` subfolder inside `msq-core` (see `msq-core`'s README), which
doubles as the parent pnpm workspace root (D5 Stage 1). Not buildable in
isolation.

## Status — Stage D extraction in progress, known gaps

Same gaps as msq-lms (see its README for full detail), applied here:

1. **Cannot bootstrap a database alone** — `db_scripts/01_init-db.sql` and
   `10_init-hr-task-schemas.sql` are still schema-interleaved with shared and
   task DDL. Run `msq-core`'s `db_deploy.ps1` first.
2. **Drizzle table-type split not done** — `hr.*` table definitions still
   live in `msq-core`'s `packages/db/src/schema/`. A local `@hr/db-schema`
   package is a tracked follow-up.
3. **Cross-repo Docker networking not wired.**
4. **Docker image builds need `msq-core`'s root as build context**, not this
   repo alone — e.g. `docker build -f msq-hrms/services/hr-service/Dockerfile .`
   run from `msq-core/`. Verified working this way.
5. **`turbo`/`depcruise`/`lint` need this repo's own `pnpm install`, which
   breaks `@platform/*` resolution** — same tooling gap as msq-lms. Verify
   via `pnpm --filter "./msq-hrms/**" run build|typecheck` from `msq-core`'s
   root instead.

**HR profiles for Team-created members.** `hr.employee_profiles` rows are created
and re-filed by identity-service calling hr-service's service-to-service
`POST /api/v1/internal/employees/sync` (`src/api/v1/internal/`, `X-Internal-Secret`,
not proxied by the gateway) after every Admin → Team create/edit. It only writes
the home branch and active flag; joining date, code, department, designation and
weekly off stay HR-owned on Leave Administration → Employees. See
`docs/Architecture.md` in the platform root.

Face verification for attendance punches runs in-process inside hr-service
(ONNX models in `services/hr-service/models/`, engine in
`services/hr-service/src/lib/face/`) — no separate face service. It needs one
secret, `FACE_TEMPLATE_KEY`, and is documented in `docs/FACE_VERIFICATION.md`
in the platform root.

## Local dev (Stage 1 — pnpm workspace, no registry)

```
make install   # run from msq-core's root, not from inside this repo alone
make dev       # requires msq-core's `make dev-infra` + `make dev` already running
```
