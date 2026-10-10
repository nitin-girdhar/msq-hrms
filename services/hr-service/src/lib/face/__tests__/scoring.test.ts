import { describe, it, expect } from 'vitest';
import { SCORE_ANCHORS, similarityToScore } from '../scoring';

describe('similarityToScore', () => {
  it('hits every anchor exactly', () => {
    for (const [cos, score] of SCORE_ANCHORS) {
      expect(similarityToScore(cos)).toBe(score);
    }
  });

  it('clamps below the first and above the last anchor', () => {
    expect(similarityToScore(-1)).toBe(0);
    expect(similarityToScore(0)).toBe(0);
    expect(similarityToScore(0.95)).toBe(100);
    expect(similarityToScore(1)).toBe(100);
  });

  it('treats NaN / Infinity as no similarity', () => {
    expect(similarityToScore(Number.NaN)).toBe(0);
    expect(similarityToScore(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('is monotonic non-decreasing across the whole cosine range', () => {
    let prev = -1;
    for (let c = -1; c <= 1.0001; c += 0.001) {
      const s = similarityToScore(c);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('rounds to 2 decimals and stays inside numeric(5,2) 0–100', () => {
    for (let c = 0; c <= 1; c += 0.0137) {
      const s = similarityToScore(c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
      expect(Math.round(s * 100) / 100).toBe(s);
    }
  });

  it('anchors are strictly increasing in both cosine and score', () => {
    for (let i = 1; i < SCORE_ANCHORS.length; i++) {
      expect(SCORE_ANCHORS[i]![0]).toBeGreaterThan(SCORE_ANCHORS[i - 1]![0]);
      expect(SCORE_ANCHORS[i]![1]).toBeGreaterThan(SCORE_ANCHORS[i - 1]![1]);
    }
  });

  it('keeps OpenCV’s published SFace threshold (0.363) at 75, below the default 85', () => {
    expect(similarityToScore(0.363)).toBe(75);
    expect(similarityToScore(0.363)).toBeLessThan(85);
  });
});
