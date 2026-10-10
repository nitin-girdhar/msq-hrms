// ─────────────────────────────────────────────────────────────────────────────
// Punch-flow face-verification decision logic.
//
// This is the heart of the feature and the most important artifact to test: given
// whether the user is enrolled, the org rule (threshold + flag/block action), and
// the engine's verdict (or an outage), it decides what to persist on the punch —
// WITHOUT any DB or HTTP knowledge, so the full matrix is unit-testable with a
// mock engine.
//
// Decision matrix (Prompt: face verification):
//   not enrolled        + block → FaceBlockedError(FACE_NOT_ENROLLED)
//   not enrolled        + flag  → passed=NULL, review='pending'
//   score >= threshold          → passed=true,  review=NULL
//   score <  threshold  + block → FaceBlockedError(FACE_MISMATCH, {score,threshold})
//   score <  threshold  + flag  → passed=false, review='pending', notify manager
//   engine UNAVAILABLE          → passed=NULL, review='pending'  (NEVER rejects)
// ─────────────────────────────────────────────────────────────────────────────

import {
  FaceServiceUnavailableError,
  type FaceDiagnostics,
  type FaceEngine,
  type FaceTemplate,
} from './driver.js';

export type FaceMatchAction = 'flag' | 'block';

export interface FaceRules {
  threshold: number;
  action: FaceMatchAction;
}

export interface FaceOutcome {
  /** 0–100, or null when not enrolled / service unavailable. */
  score: number | null;
  /** true=matched, false=mismatch (flag), null=undetermined (not-enrolled/outage). */
  passed: boolean | null;
  /** 'pending' when the punch needs human review; null when it passed clean. */
  reviewStatus: 'pending' | null;
  /** true only when a pending review warrants a manager notification (flag mismatch). */
  notifyManager: boolean;
  /** Engine measurements (similarity, liveness, …) when a verification ran; null otherwise. */
  diagnostics: FaceDiagnostics | null;
}

// A deterministic block decision. The repository maps this to a 422 with `code`
// (FACE_NOT_ENROLLED | FACE_MISMATCH) and `details` (score + threshold on mismatch).
export class FaceBlockedError extends Error {
  constructor(
    public readonly code: 'FACE_NOT_ENROLLED' | 'FACE_MISMATCH',
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'FaceBlockedError';
  }
}

const NOT_ENROLLED_FLAG: FaceOutcome = { score: null, passed: null, reviewStatus: 'pending', notifyManager: false, diagnostics: null };
// Exported so a caller that cannot even reach verification (e.g. an undecryptable
// stored template) records the identical fail-open outcome.
export const FACE_UNAVAILABLE_OUTCOME: FaceOutcome = { score: null, passed: null, reviewStatus: 'pending', notifyManager: false, diagnostics: null };

export async function resolvePunchFace(opts: {
  engine: FaceEngine;
  /** The user's decrypted template, or null when not enrolled. */
  template: FaceTemplate | null;
  photo: Buffer;
  rules: FaceRules;
  log?: (message: string, err?: unknown) => void;
}): Promise<FaceOutcome> {
  const { engine, template, photo, rules, log } = opts;

  // ── Not enrolled ──
  if (!template) {
    if (rules.action === 'block') throw new FaceBlockedError('FACE_NOT_ENROLLED');
    return NOT_ENROLLED_FLAG;
  }

  // ── Verify against the template; an outage NEVER rejects the punch ──
  let score: number;
  let matched: boolean;
  let diagnostics: FaceDiagnostics;
  try {
    const result = await engine.verify(template, photo, rules.threshold);
    score = result.score;
    matched = result.matched;
    diagnostics = result.diagnostics;
  } catch (err) {
    // Model load / inference / template failure → fail open with a pending review.
    if (!(err instanceof FaceServiceUnavailableError)) {
      log?.('[face] verify failed (treated as unavailable)', err);
    } else {
      log?.('[face] service unavailable during punch verification', err);
    }
    return FACE_UNAVAILABLE_OUTCOME;
  }

  // ── Passed ──
  if (matched) {
    return { score, passed: true, reviewStatus: null, notifyManager: false, diagnostics };
  }

  // ── Mismatch ──
  if (rules.action === 'block') {
    throw new FaceBlockedError('FACE_MISMATCH', { score, threshold: rules.threshold });
  }
  return { score, passed: false, reviewStatus: 'pending', notifyManager: true, diagnostics };
}
