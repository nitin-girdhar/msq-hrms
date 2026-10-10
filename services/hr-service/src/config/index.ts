import path from 'node:path';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[hr-service] Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: parseInt(process.env['HR_SERVICE_PORT'] ?? '4007', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseUrlService: requireEnv('DATABASE_URL_SERVICE'),
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
  // Attendance photo storage (see lib/storage/photo-storage.ts). Shared with
  // identity-service via one volume — both must resolve to the same directory,
  // so BLOB_STORAGE_* is preferred; the legacy PHOTO_STORAGE_* vars remain as a
  // fallback for existing deployments.
  photoStorageDriver: process.env['BLOB_STORAGE_DRIVER'] ?? process.env['PHOTO_STORAGE_DRIVER'] ?? 'local',
  photoStorageDir: process.env['BLOB_STORAGE_DIR'] ?? process.env['PHOTO_STORAGE_DIR'] ?? '/data/blobs',
  // Accept keys written before the tenant-first layout (`punch/…`, `documents/…`,
  // `leave/…`, `avatar/…`). Set BLOB_ALLOW_LEGACY_KEYS=false once migrate-blob-layout has run.
  blobAllowLegacyKeys: (process.env['BLOB_ALLOW_LEGACY_KEYS'] ?? 'true') !== 'false',
  photoMaxBytes: parseInt(process.env['PHOTO_MAX_BYTES'] ?? String(2 * 1024 * 1024), 10),
  // Face verification (see lib/face/). The in-process ONNX engine loads its
  // models lazily, so nothing here blocks startup — it only matters once an org
  // turns on require_face_match. Models ship inside the image (services/hr-service/
  // models, resolved from dist/config or src/config alike).
  faceModelsDir: process.env['FACE_MODELS_DIR'] ?? path.resolve(__dirname, '../../models'),
  // 32-byte AES-256-GCM key (64 hex chars or base64) for hr.face_templates.
  // Enrollment and verification refuse to run without it (fail closed / fail
  // open respectively); losing it means every employee must re-enroll.
  faceTemplateKey: process.env['FACE_TEMPLATE_KEY'] ?? '',
  // Anti-spoof floor: below this "real person" probability a punch selfie is
  // treated as a photo/screen and scores 0 (see docs/FACE_VERIFICATION.md;
  // keep in step with DEFAULT_LIVENESS_MIN in lib/face/onnx.engine.ts).
  faceLivenessMin: parseFloat(process.env['FACE_LIVENESS_MIN'] ?? '0.5'),
} as const;
