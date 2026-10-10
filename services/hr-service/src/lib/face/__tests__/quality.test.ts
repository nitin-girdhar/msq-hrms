import { describe, it, expect } from 'vitest';
import { assessEnrollment, estimatePose, REJECTION_MESSAGES } from '../quality';
import { FaceEnrollmentError, type FaceEnrollmentRejection } from '../driver';
import type { Point, RgbImage } from '../image';
import type { DetectedFace } from '../yunet';
import { SFACE_TEMPLATE } from '../sface';

// A frontal face: the canonical SFace landmarks scaled ×3 and shifted into a
// 640-px frame, so the eyes are ~106 px apart and the box is 300×360.
function face(overrides: Partial<DetectedFace> = {}, transform: (p: Point) => Point = (p) => p): DetectedFace {
  const lm = SFACE_TEMPLATE.map(([x, y]) => transform([x * 3 + 150, y * 3 + 100])) as DetectedFace['landmarks'];
  return { x: 150, y: 100, w: 300, h: 360, landmarks: lm, score: 0.95, ...overrides };
}

function image(px: (x: number, y: number) => number): RgbImage {
  const data = new Uint8Array(112 * 112 * 3);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const v = Math.max(0, Math.min(255, Math.round(px(x, y))));
      data.set([v, v, v], (y * 112 + x) * 3);
    }
  }
  return { data, width: 112, height: 112 };
}

const checker = (lo: number, hi: number) => image((x, y) => ((x >> 2) + (y >> 2)) % 2 ? hi : lo);
const GOOD = checker(70, 190);

function reason(fn: () => unknown): FaceEnrollmentRejection | null {
  try {
    fn();
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(FaceEnrollmentError);
    return (err as FaceEnrollmentError).reason;
  }
}

function rotate(deg: number): (p: Point) => Point {
  const r = (deg * Math.PI) / 180;
  const cx = 300;
  const cy = 280;
  return ([x, y]) => [cx + (x - cx) * Math.cos(r) - (y - cy) * Math.sin(r), cy + (x - cx) * Math.sin(r) + (y - cy) * Math.cos(r)];
}

describe('assessEnrollment', () => {
  it('accepts a sharp, well-lit, frontal, single face and reports its measurements', () => {
    const f = face();
    const q = assessEnrollment([f], f, GOOD);
    expect(q.face_count).toBe(1);
    expect(q.inter_eye_px).toBeCloseTo(105.7, 0);
    expect(Math.abs(q.yaw_deg)).toBeLessThan(1);
    expect(Math.abs(q.roll_deg)).toBeLessThan(1);
    expect(q.pitch_ratio).toBeCloseTo(0.494, 2);
  });

  it('no face / low detector confidence → no_face', () => {
    expect(reason(() => assessEnrollment([], null, null))).toBe('no_face');
    const weak = face({ score: 0.7 });
    expect(reason(() => assessEnrollment([weak], weak, GOOD))).toBe('no_face');
  });

  it('a second face of comparable size → multiple_faces; a small background face is fine', () => {
    const main = face();
    const rival = face({ x: 0, w: 250, h: 300 });
    expect(reason(() => assessEnrollment([main, rival], main, GOOD))).toBe('multiple_faces');
    const tiny = face({ x: 0, w: 40, h: 50 });
    expect(reason(() => assessEnrollment([main, tiny], main, GOOD))).toBeNull();
  });

  it('a small face → face_too_small', () => {
    const shrink = (p: Point): Point => [300 + (p[0] - 300) / 4, 280 + (p[1] - 280) / 4];
    const f = face({ w: 75, h: 90 }, shrink);
    expect(reason(() => assessEnrollment([f], f, GOOD))).toBe('face_too_small');
  });

  it('head roll beyond the limit → not_frontal; a slight roll passes', () => {
    const tilted = face({}, rotate(25));
    expect(reason(() => assessEnrollment([tilted], tilted, GOOD))).toBe('not_frontal');
    const slight = face({}, rotate(8));
    expect(reason(() => assessEnrollment([slight], slight, GOOD))).toBeNull();
  });

  it('nose pushed sideways (turned head) → not_frontal', () => {
    const f = face();
    const turned: DetectedFace = { ...f, landmarks: [f.landmarks[0], f.landmarks[1], [f.landmarks[2][0] + 25, f.landmarks[2][1]], f.landmarks[3], f.landmarks[4]] };
    expect(reason(() => assessEnrollment([turned], turned, GOOD))).toBe('not_frontal');
  });

  it('nose near the eye line (head tipped back) → not_frontal', () => {
    const f = face();
    const tipped: DetectedFace = { ...f, landmarks: [f.landmarks[0], f.landmarks[1], [f.landmarks[2][0], f.landmarks[0][1] + 15], f.landmarks[3], f.landmarks[4]] };
    expect(reason(() => assessEnrollment([tipped], tipped, GOOD))).toBe('not_frontal');
  });

  it('dark / bright / washed-out crops are rejected with the matching reason', () => {
    const f = face();
    expect(reason(() => assessEnrollment([f], f, checker(5, 60)))).toBe('too_dark');
    expect(reason(() => assessEnrollment([f], f, checker(215, 250)))).toBe('too_bright');
    expect(reason(() => assessEnrollment([f], f, checker(120, 136)))).toBe('low_contrast');
  });

  it('a smooth, edge-free crop with good light and contrast → blurry', () => {
    const f = face();
    const smooth = image((x) => 70 + x);
    expect(reason(() => assessEnrollment([f], f, smooth))).toBe('blurry');
  });

  it('every rejection carries a human message', () => {
    for (const msg of Object.values(REJECTION_MESSAGES)) expect(msg.length).toBeGreaterThan(20);
  });
});

describe('estimatePose', () => {
  it('reads the canonical template as frontal', () => {
    const p = estimatePose(face().landmarks);
    expect(Math.abs(p.rollDeg)).toBeLessThan(0.5);
    expect(Math.abs(p.yawDeg)).toBeLessThan(0.5);
  });

  it('recovers an applied roll and is unaffected by it for yaw/pitch', () => {
    const p = estimatePose(face({}, rotate(12)).landmarks);
    expect(p.rollDeg).toBeCloseTo(12, 0);
    expect(Math.abs(p.yawDeg)).toBeLessThan(1);
    expect(p.pitchRatio).toBeCloseTo(0.494, 2);
  });
});
