// ─────────────────────────────────────────────────────────────────────────────
// Cosine similarity → 0–100 match score.
//
// Org admins set face_match_threshold on a 50–100 scale (default 85). This map
// gives those numbers a fixed meaning for the SFace model:
//
//   cosine ≤ 0.10  →   0   unrelated faces cluster here
//   cosine  0.363  →  75   OpenCV's published SFace threshold (LFW balanced point)
//   cosine  ANCHOR_85 → 85 the default threshold: false-accept rate ≤ 0.1% (calibrated)
//   cosine ≥ 0.70  → 100   same person, same conditions
//
// Piecewise-linear between anchors, monotonic, clamped, rounded to 2 decimals so
// it fits hr.attendance_events.face_match_score numeric(5,2). Raising the org
// threshold always demands a higher cosine; lowering it below 75 accepts matches
// looser than OpenCV's own recommendation.
// ─────────────────────────────────────────────────────────────────────────────

/** [cosine, score] pairs, strictly increasing in both. */
export const SCORE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0],
  [0.363, 75],
  [0.45, 85],
  [0.7, 100],
];

export function similarityToScore(cos: number): number {
  const first = SCORE_ANCHORS[0]!;
  const last = SCORE_ANCHORS[SCORE_ANCHORS.length - 1]!;
  if (!Number.isFinite(cos) || cos <= first[0]) return first[1];
  if (cos >= last[0]) return last[1];
  for (let i = 1; i < SCORE_ANCHORS.length; i++) {
    const [c1, s1] = SCORE_ANCHORS[i]!;
    if (cos <= c1) {
      const [c0, s0] = SCORE_ANCHORS[i - 1]!;
      const score = s0 + ((cos - c0) / (c1 - c0)) * (s1 - s0);
      return Math.round(score * 100) / 100;
    }
  }
  return last[1];
}
