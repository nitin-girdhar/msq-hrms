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
  // Attendance photo storage (see lib/storage/photo-storage.ts).
  photoStorageDriver: process.env['PHOTO_STORAGE_DRIVER'] ?? 'local',
  photoStorageDir: process.env['PHOTO_STORAGE_DIR'] ?? '/data/attendance-photos',
  photoMaxBytes: parseInt(process.env['PHOTO_MAX_BYTES'] ?? String(2 * 1024 * 1024), 10),
  // Face verification (see lib/face/). The driver is constructed lazily, so a
  // missing API key never blocks startup — it only matters once an org turns on
  // require_face_match. CompreFace is an internal-only dependency of hr-service.
  faceDriver: process.env['FACE_DRIVER'] ?? 'compreface',
  comprefaceUrl: process.env['COMPREFACE_URL'] ?? 'http://compreface-api:8080',
  comprefaceApiKey: process.env['COMPREFACE_API_KEY'] ?? '',
  faceVerifyTimeoutMs: parseInt(process.env['FACE_VERIFY_TIMEOUT_MS'] ?? '5000', 10),
} as const;
