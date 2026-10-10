// ─────────────────────────────────────────────────────────────────────────────
// SFace face recognizer (opencv_zoo face_recognition_sface_2021dec.onnx,
// Apache-2.0; MobileFaceNet trained with the SFace loss).
//
// The face is first aligned: a similarity transform maps YuNet's 5 landmarks
// onto the canonical 112×112 ArcFace template below (the same points OpenCV's
// FaceRecognizerSF::alignCrop uses). Input is then 1×3×112×112 float32 RGB, raw
// 0–255 (OpenCV feeds blobFromImage(aligned, 1, …, swapRB=true)). Output `fc1`
// is a 128-d embedding, L2-normalised here so cosine similarity = dot product.
// ─────────────────────────────────────────────────────────────────────────────

import type { InferenceSession } from 'onnxruntime-node';
import {
  type Point,
  type RgbImage,
  estimateSimilarity,
  toChwTensor,
  warpSimilarity,
} from './image.js';
import type { DetectedFace } from './yunet.js';

export const SFACE_SIZE = 112;

/** Canonical landmark positions in the 112×112 aligned crop
 *  (right eye, left eye, nose, right mouth, left mouth). */
export const SFACE_TEMPLATE: readonly Point[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

type OrtModule = typeof import('onnxruntime-node');

/** Warp the detected face into the canonical 112×112 crop. */
export function alignFace(img: RgbImage, face: DetectedFace): RgbImage {
  const m = estimateSimilarity(face.landmarks, SFACE_TEMPLATE);
  return warpSimilarity(img, m, SFACE_SIZE, SFACE_SIZE);
}

export async function embedAligned(ort: OrtModule, session: InferenceSession, aligned: RgbImage): Promise<Float32Array> {
  const input = new ort.Tensor('float32', toChwTensor(aligned, 'rgb'), [1, 3, SFACE_SIZE, SFACE_SIZE]);
  const out = await session.run({ [session.inputNames[0]!]: input });
  const raw = out[session.outputNames[0]!]!.data as Float32Array;
  return l2normalize(raw);
}

export function l2normalize(v: Float32Array): Float32Array {
  let sq = 0;
  for (const x of v) sq += x * x;
  const norm = Math.sqrt(sq) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

/** Cosine similarity of two L2-normalised embeddings. */
export function cosine(p: Float32Array, q: Float32Array): number {
  if (p.length !== q.length) throw new Error(`embedding length mismatch ${p.length} vs ${q.length}`);
  let dot = 0;
  for (let i = 0; i < p.length; i++) dot += p[i]! * q[i]!;
  return dot;
}
