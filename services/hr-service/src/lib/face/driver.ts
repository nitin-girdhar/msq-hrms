// ─────────────────────────────────────────────────────────────────────────────
// Face-engine contract.
//
// The punch flow, enrollment and the review queue call `getFaceEngine()` and
// never name a model. The engine is pure computation: it turns a reference photo
// into a template and scores a probe against a template. Storing the template
// (encrypted, tenant-scoped) is the repository's job, not the engine's.
//
// Scores are normalized to a 0–100 scale at the engine boundary so the rest of
// the service (and the DB column hr.attendance_events.face_match_score
// numeric(5,2)) never sees a raw cosine similarity.
// ─────────────────────────────────────────────────────────────────────────────

/** A face embedding plus the model that produced it. Embeddings from different
 *  models are not comparable, so the version always travels with the vector. */
export interface FaceTemplate {
  modelVersion: string;
  /** L2-normalised embedding (cosine similarity = dot product). */
  embedding: Float32Array;
}

/** Numbers recorded with every verification so a reviewer (or support) can see
 *  WHY a punch scored what it did. Never contains image data or identity. */
export interface FaceDiagnostics {
  /** Raw cosine similarity probe↔template, or null when no face was found. */
  similarity: number | null;
  /** Anti-spoof "real person" probability 0–1, or null when no face was found. */
  liveness: number | null;
  /** Detector confidence of the face that was scored. */
  det_score: number | null;
  model_version: string;
}

export interface FaceVerifyResult {
  /** Similarity of the probe against the template, 0–100 (0 for no face or a spoof). */
  score: number;
  /** True when `score >= thresholdPct`. */
  matched: boolean;
  diagnostics: FaceDiagnostics;
}

/** Quality measurements taken at enrollment, stored alongside the template. */
export interface FaceQualityMetrics {
  det_score: number;
  face_count: number;
  inter_eye_px: number;
  face_short_side_px: number;
  yaw_deg: number;
  roll_deg: number;
  pitch_ratio: number;
  sharpness: number;
  luma_mean: number;
  luma_std: number;
}

export interface FaceEnrollment {
  template: FaceTemplate;
  quality: FaceQualityMetrics;
}

export interface FaceEngine {
  /** Build a template from a reference photo. Runs the enrollment quality gate
   *  and throws FaceEnrollmentError(reason) when the photo is not usable. */
  enroll(image: Buffer): Promise<FaceEnrollment>;

  /** Score a probe image against an enrolled template at the given threshold. */
  verify(template: FaceTemplate, image: Buffer, thresholdPct: number): Promise<FaceVerifyResult>;
}

// Model failed to load, inference threw, or the stored template cannot be used
// (wrong model version, undecryptable). The punch flow catches this and FAILS
// OPEN (records the punch with a pending review) — an attendance event must never
// be lost to a verification failure.
export class FaceServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceServiceUnavailableError';
  }
}

export type FaceEnrollmentRejection =
  | 'no_face'
  | 'multiple_faces'
  | 'face_too_small'
  | 'not_frontal'
  | 'blurry'
  | 'too_dark'
  | 'too_bright'
  | 'low_contrast';

// A deterministic, client-attributable failure during enrollment (no face, or a
// photo that fails the quality gate). Distinct from UNAVAILABLE — this must
// surface to the caller as a 4xx, never fail open.
export class FaceEnrollmentError extends Error {
  constructor(
    public readonly reason: FaceEnrollmentRejection,
    message: string,
  ) {
    super(message);
    this.name = 'FaceEnrollmentError';
  }
}
