// ─────────────────────────────────────────────────────────────────────────────
// YuNet face detector (opencv_zoo face_detection_yunet_2023mar.onnx, Apache-2.0).
//
// Input: 1×3×640×640 float32 BGR, raw 0–255, image placed top-left on a zero
// canvas (so output coordinates are already in image pixels — no rescale).
// Output, per stride s ∈ {8,16,32} over a (640/s)² grid:
//   cls_s, obj_s  [N,1]  → score = sqrt(clamp(cls)·clamp(obj))
//   bbox_s        [N,4]  → cx=(col+dx)·s, cy=(row+dy)·s, w=exp(dw)·s, h=exp(dh)·s
//   kps_s         [N,10] → 5 landmarks, (col+kx)·s, (row+ky)·s
// This mirrors OpenCV's FaceDetectorYN post-processing for the 2023mar model.
// Landmark order: right eye, left eye, nose tip, right mouth corner, left mouth
// corner — "right" being the subject's right, i.e. the LEFT side of the image.
// ─────────────────────────────────────────────────────────────────────────────

import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { type Point, type RgbImage, toPaddedBgrTensor } from './image.js';

export const YUNET_INPUT = 640;
const STRIDES = [8, 16, 32] as const;
const NMS_IOU = 0.3;
/** Candidate floor. Enrollment demands far more (see quality.ts); verification
 *  takes the best face it can find, and a weak detection scores low anyway. */
export const DETECT_MIN_SCORE = 0.6;
const TOP_K = 50;

export interface DetectedFace {
  x: number;
  y: number;
  w: number;
  h: number;
  /** [rightEye, leftEye, nose, rightMouth, leftMouth] in image pixels. */
  landmarks: [Point, Point, Point, Point, Point];
  score: number;
}

type OrtModule = typeof import('onnxruntime-node');

export async function detectFaces(ort: OrtModule, session: InferenceSession, img: RgbImage): Promise<DetectedFace[]> {
  const input = new ort.Tensor('float32', toPaddedBgrTensor(img, YUNET_INPUT), [1, 3, YUNET_INPUT, YUNET_INPUT]);
  const out = await session.run({ [session.inputNames[0]!]: input });
  return decodeYunet(out, img.width, img.height);
}

/** Pure post-processing, exported for tests. Faces are sorted by score, NMS'd,
 *  and restricted to those whose centre lies inside the real (unpadded) image. */
export function decodeYunet(out: Record<string, Tensor>, imgW: number, imgH: number): DetectedFace[] {
  const candidates: DetectedFace[] = [];
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`]!.data as Float32Array;
    const obj = out[`obj_${s}`]!.data as Float32Array;
    const bbox = out[`bbox_${s}`]!.data as Float32Array;
    const kps = out[`kps_${s}`]!.data as Float32Array;
    const cols = YUNET_INPUT / s;
    const n = cls.length;
    for (let i = 0; i < n; i++) {
      const c = Math.min(Math.max(cls[i]!, 0), 1);
      const o = Math.min(Math.max(obj[i]!, 0), 1);
      const score = Math.sqrt(c * o);
      if (score < DETECT_MIN_SCORE) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const cx = (col + bbox[i * 4]!) * s;
      const cy = (row + bbox[i * 4 + 1]!) * s;
      const w = Math.exp(bbox[i * 4 + 2]!) * s;
      const h = Math.exp(bbox[i * 4 + 3]!) * s;
      if (cx < 0 || cy < 0 || cx >= imgW || cy >= imgH) continue;
      const lm = (k: number): Point => [(col + kps[i * 10 + 2 * k]!) * s, (row + kps[i * 10 + 2 * k + 1]!) * s];
      candidates.push({ x: cx - w / 2, y: cy - h / 2, w, h, landmarks: [lm(0), lm(1), lm(2), lm(3), lm(4)], score });
    }
  }
  candidates.sort((p, q) => q.score - p.score);
  const kept: DetectedFace[] = [];
  for (const f of candidates) {
    if (kept.every((k) => iou(k, f) <= NMS_IOU)) kept.push(f);
    if (kept.length >= TOP_K) break;
  }
  return kept;
}

export function iou(p: DetectedFace, q: DetectedFace): number {
  const x1 = Math.max(p.x, q.x);
  const y1 = Math.max(p.y, q.y);
  const x2 = Math.min(p.x + p.w, q.x + q.w);
  const y2 = Math.min(p.y + p.h, q.y + q.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = p.w * p.h + q.w * q.h - inter;
  return union > 0 ? inter / union : 0;
}

/** The face that should be scored: the largest box (the person holding the
 *  phone), not merely the most confident one. */
export function largestFace(faces: DetectedFace[]): DetectedFace | null {
  let best: DetectedFace | null = null;
  for (const f of faces) if (!best || f.w * f.h > best.w * best.h) best = f;
  return best;
}
