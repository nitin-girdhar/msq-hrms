// ─────────────────────────────────────────────────────────────────────────────
// Silent anti-spoofing: two MiniFASNet models (minivision-ai Silent-Face-Anti-
// Spoofing, Apache-2.0), exported to ONNX by msq-hrms/scripts/face-models/
// export_minifasnet.py with the softmax folded into the graph.
//
// Each model looks at a different amount of context around the face box:
//   MiniFASNetV2   crop = 2.7 × face box   (texture / moiré of a screen or print)
//   MiniFASNetV1SE crop = 4.0 × face box   (bezel, hands, paper edge around it)
// Input 1×3×80×80 float32 BGR, raw 0–255 (upstream's ToTensor does not divide by
// 255). Output [fake_print, real, fake_replay]; liveness = mean of the two
// models' "real" probability.
// ─────────────────────────────────────────────────────────────────────────────

import type { InferenceSession } from 'onnxruntime-node';
import { type RgbImage, cropResize, toChwTensor } from './image.js';
import type { DetectedFace } from './yunet.js';

export const ANTISPOOF_SIZE = 80;
const REAL_CLASS = 1;

export interface AntiSpoofModel {
  session: InferenceSession;
  /** Context multiplier applied to the face box before cropping. */
  scale: number;
}

type OrtModule = typeof import('onnxruntime-node');

/** Upstream CropImage._get_new_box: grow the box by `scale` about its centre
 *  (capped so it still fits), then shift it back inside the image. Returns the
 *  inclusive pixel box. */
export function scaledBox(
  imgW: number,
  imgH: number,
  face: Pick<DetectedFace, 'x' | 'y' | 'w' | 'h'>,
  scale: number,
): [number, number, number, number] {
  const s = Math.min((imgH - 1) / face.h, (imgW - 1) / face.w, scale);
  const nw = face.w * s;
  const nh = face.h * s;
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  let x1 = cx - nw / 2;
  let y1 = cy - nh / 2;
  let x2 = cx + nw / 2;
  let y2 = cy + nh / 2;
  if (x1 < 0) { x2 -= x1; x1 = 0; }
  if (y1 < 0) { y2 -= y1; y1 = 0; }
  if (x2 > imgW - 1) { x1 -= x2 - imgW + 1; x2 = imgW - 1; }
  if (y2 > imgH - 1) { y1 -= y2 - imgH + 1; y2 = imgH - 1; }
  return [Math.trunc(x1), Math.trunc(y1), Math.trunc(x2), Math.trunc(y2)];
}

/** Probability (0–1) that the face is a live person rather than a print/screen. */
export async function liveness(
  ort: OrtModule,
  models: AntiSpoofModel[],
  img: RgbImage,
  face: DetectedFace,
): Promise<number> {
  let sum = 0;
  for (const m of models) {
    const [x1, y1, x2, y2] = scaledBox(img.width, img.height, face, m.scale);
    const patch = cropResize(img, x1, y1, x2, y2, ANTISPOOF_SIZE, ANTISPOOF_SIZE);
    const input = new ort.Tensor('float32', toChwTensor(patch, 'bgr'), [1, 3, ANTISPOOF_SIZE, ANTISPOOF_SIZE]);
    const out = await m.session.run({ [m.session.inputNames[0]!]: input });
    const prob = out[m.session.outputNames[0]!]!.data as Float32Array;
    sum += prob[REAL_CLASS]!;
  }
  return sum / models.length;
}
