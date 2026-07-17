// ─────────────────────────────────────────────────────────────────────────────
// Face-verification driver contract.
//
// A vendor-neutral interface so the punch flow, enrollment, and review queue call
// `getFaceDriver()` without ever naming CompreFace. A cloud driver (AWS Rekognition
// et al.) can be added later by implementing this interface and wiring it into the
// factory in ./index.ts — no call site changes.
//
// Scores are normalized to a 0–100 scale at the driver boundary so the rest of the
// service (and the DB column hr.attendance_events.face_match_score numeric(5,2))
// never sees a vendor's 0–1 similarity.
// ─────────────────────────────────────────────────────────────────────────────

export interface FaceVerifyResult {
  /** Similarity of the probe against the subject, 0–100. */
  score: number;
  /** True when `score >= thresholdPct` (computed by the driver). */
  matched: boolean;
}

export interface FaceVerificationDriver {
  /** Enroll (add a reference face to) a subject. Idempotent per call; the caller
   *  deletes first to fully replace an existing subject's faces. */
  enrollSubject(subjectId: string, image: Buffer): Promise<void>;

  /** Remove a subject and all its faces. Must resolve (not throw) if the subject
   *  does not exist, so unenroll is idempotent. */
  deleteSubject(subjectId: string): Promise<void>;

  /** Verify a probe image against an enrolled subject at the given threshold. */
  verify(subjectId: string, image: Buffer, thresholdPct: number): Promise<FaceVerifyResult>;

  /** True when the backend is reachable and healthy. */
  healthCheck(): Promise<boolean>;
}

// Timeout, connection failure, or a 5xx from the backend. The punch flow catches
// this and FAILS OPEN (records the punch with a pending review) — an attendance
// event must never be lost to a verification-dependency outage.
export class FaceServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceServiceUnavailableError';
  }
}

// A deterministic, client-attributable failure during enrollment (e.g. the
// reference photo contains no detectable face). Distinct from UNAVAILABLE — this
// must surface to the caller as a 4xx, never fail open.
export class FaceEnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceEnrollmentError';
  }
}
