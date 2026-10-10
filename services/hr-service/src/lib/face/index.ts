// ─────────────────────────────────────────────────────────────────────────────
// Face-engine factory. One in-process ONNX engine per hr-service process,
// constructed lazily: models load on the first enroll/verify, never at startup.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from '../../config/index.js';
import type { FaceEngine } from './driver.js';
import { OnnxFaceEngine } from './onnx.engine.js';

export {
  type FaceEngine,
  type FaceTemplate,
  type FaceVerifyResult,
  type FaceDiagnostics,
  type FaceQualityMetrics,
  FaceServiceUnavailableError,
  FaceEnrollmentError,
} from './driver.js';
export { encryptTemplate, decryptTemplate } from './template-crypto.js';

let singleton: FaceEngine | null = null;

export function getFaceEngine(): FaceEngine {
  if (!singleton) singleton = new OnnxFaceEngine(config.faceModelsDir, config.faceLivenessMin);
  return singleton;
}

// Test seam: override the singleton (or reset with null).
export function __setFaceEngineForTest(engine: FaceEngine | null): void {
  singleton = engine;
}
