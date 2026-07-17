// ─────────────────────────────────────────────────────────────────────────────
// Face-driver factory. Env-selected (FACE_DRIVER) and lazily constructed, so a
// missing COMPREFACE_API_KEY never blocks service startup — the driver is only
// built the first time an org with require_face_match punches or enrolls.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from '../../config/index.js';
import { ComprefaceDriver } from './compreface.driver.js';
import type { FaceVerificationDriver } from './driver.js';

export {
  type FaceVerificationDriver,
  type FaceVerifyResult,
  FaceServiceUnavailableError,
  FaceEnrollmentError,
} from './driver.js';

let singleton: FaceVerificationDriver | null = null;

export function getFaceDriver(): FaceVerificationDriver {
  if (singleton) return singleton;
  switch (config.faceDriver) {
    case 'compreface':
      singleton = new ComprefaceDriver(config.comprefaceUrl, config.comprefaceApiKey, config.faceVerifyTimeoutMs);
      return singleton;
    default:
      throw new Error(`Unsupported FACE_DRIVER: ${config.faceDriver}`);
  }
}

// Test seam: override the singleton (or reset with null).
export function __setFaceDriverForTest(driver: FaceVerificationDriver | null): void {
  singleton = driver;
}
