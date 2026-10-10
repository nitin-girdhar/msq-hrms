// ─────────────────────────────────────────────────────────────────────────────
// Pixel plumbing for the face engine: decode, sample, crop, align, tensorise.
//
// Everything here is plain arithmetic over an interleaved RGB byte buffer so it is
// unit-testable without models. `sharp` is used only to decode (and EXIF-rotate,
// and cap the size of) the incoming JPEG/PNG/WebP.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from 'sharp';

/** Interleaved RGB, 8 bits per channel, row-major. */
export interface RgbImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export type Point = readonly [number, number];

/** Longest side after decode. YuNet runs on a fixed 640×640 canvas, so anything
 *  larger is wasted work, and phone selfies are routinely 3000+ px. */
export const MAX_SIDE = 640;

/** Decode any sharp-supported image, apply EXIF orientation, drop alpha and
 *  downscale so the longest side is at most MAX_SIDE. Throws on undecodable input. */
export async function decodeImage(buf: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(buf, { failOn: 'error' })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`expected 3 channels, got ${info.channels}`);
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/** Bilinear sample of channel `c` at a sub-pixel position; outside the image reads 0. */
function sample(img: RgbImage, x: number, y: number, c: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const px = (xx: number, yy: number): number =>
    xx < 0 || yy < 0 || xx >= img.width || yy >= img.height ? 0 : img.data[(yy * img.width + xx) * 3 + c]!;
  const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx;
  const bottom = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Edge-clamped bilinear sample (used by resize, where there is no "outside"). */
function sampleClamped(img: RgbImage, x: number, y: number, c: number): number {
  const cx = Math.min(Math.max(x, 0), img.width - 1);
  const cy = Math.min(Math.max(y, 0), img.height - 1);
  return sample(img, cx, cy, c);
}

/** Crop the inclusive pixel box [x1..x2]×[y1..y2] and resize it to outW×outH with
 *  half-pixel-centred bilinear interpolation (cv2.resize INTER_LINEAR semantics). */
export function cropResize(img: RgbImage, x1: number, y1: number, x2: number, y2: number, outW: number, outH: number): RgbImage {
  const srcW = x2 - x1 + 1;
  const srcH = y2 - y1 + 1;
  const sx = srcW / outW;
  const sy = srcH / outH;
  const out = new Uint8Array(outW * outH * 3);
  for (let v = 0; v < outH; v++) {
    const y = y1 + (v + 0.5) * sy - 0.5;
    for (let u = 0; u < outW; u++) {
      const x = x1 + (u + 0.5) * sx - 0.5;
      for (let c = 0; c < 3; c++) {
        out[(v * outW + u) * 3 + c] = Math.round(sampleClamped(img, x, y, c));
      }
    }
  }
  return { data: out, width: outW, height: outH };
}

/** Similarity transform (rotation + uniform scale + translation, no reflection):
 *  dst ≈ [a -b; b a]·src + t. */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/** Least-squares similarity mapping `src` points onto `dst` points (the 2-D
 *  Umeyama solution, written with complex numbers: s·e^{iθ} = Σ conj(zs')·zd' / Σ|zs'|²). */
export function estimateSimilarity(src: readonly Point[], dst: readonly Point[]): Similarity {
  const n = src.length;
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) {
    msx += src[i]![0]; msy += src[i]![1];
    mdx += dst[i]![0]; mdy += dst[i]![1];
  }
  msx /= n; msy /= n; mdx /= n; mdy /= n;
  let num_re = 0, num_im = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i]![0] - msx, sy = src[i]![1] - msy;
    const dx = dst[i]![0] - mdx, dy = dst[i]![1] - mdy;
    // conj(sx + i·sy) · (dx + i·dy)
    num_re += sx * dx + sy * dy;
    num_im += sx * dy - sy * dx;
    den += sx * sx + sy * sy;
  }
  const a = den === 0 ? 1 : num_re / den;
  const b = den === 0 ? 0 : num_im / den;
  return { a, b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) };
}

export function applySimilarity(m: Similarity, p: Point): Point {
  return [m.a * p[0] - m.b * p[1] + m.tx, m.b * p[0] + m.a * p[1] + m.ty];
}

/** Warp `img` by the forward transform `m` (source → output) into an outW×outH
 *  image. Each output pixel samples the source at the inverse-mapped position. */
export function warpSimilarity(img: RgbImage, m: Similarity, outW: number, outH: number): RgbImage {
  const s2 = m.a * m.a + m.b * m.b;
  const out = new Uint8Array(outW * outH * 3);
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const du = u - m.tx;
      const dv = v - m.ty;
      const x = (m.a * du + m.b * dv) / s2;
      const y = (-m.b * du + m.a * dv) / s2;
      for (let c = 0; c < 3; c++) {
        out[(v * outW + u) * 3 + c] = Math.round(sample(img, x, y, c));
      }
    }
  }
  return { data: out, width: outW, height: outH };
}

/** NCHW float32 tensor with raw 0–255 values, in the channel order the model wants. */
export function toChwTensor(img: RgbImage, order: 'rgb' | 'bgr'): Float32Array {
  const plane = img.width * img.height;
  const out = new Float32Array(plane * 3);
  const map = order === 'rgb' ? [0, 1, 2] : [2, 1, 0];
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = img.data[i * 3 + map[c]!]!;
    }
  }
  return out;
}

/** Place the image at the top-left of a size×size zero canvas as a BGR NCHW
 *  tensor (YuNet's input). The image must already fit (see MAX_SIDE). */
export function toPaddedBgrTensor(img: RgbImage, size: number): Float32Array {
  const plane = size * size;
  const out = new Float32Array(plane * 3);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 3;
      const d = y * size + x;
      out[d] = img.data[s + 2]!;
      out[plane + d] = img.data[s + 1]!;
      out[2 * plane + d] = img.data[s]!;
    }
  }
  return out;
}

/** ITU-R BT.601 luma per pixel, 0–255. */
export function toGray(img: RgbImage): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.299 * img.data[i * 3]! + 0.587 * img.data[i * 3 + 1]! + 0.114 * img.data[i * 3 + 2]!;
  }
  return out;
}

export function meanStd(values: Float32Array): { mean: number; std: number } {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = values.length ? sum / values.length : 0;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return { mean, std: values.length ? Math.sqrt(sq / values.length) : 0 };
}

/** Variance of the 4-neighbour Laplacian over the interior — the standard
 *  focus measure: a sharp face has strong edges, a blurred one does not. */
export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  const vals: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      vals.push(gray[i - 1]! + gray[i + 1]! + gray[i - width]! + gray[i + width]! - 4 * gray[i]!);
    }
  }
  return meanStd(Float32Array.from(vals)).std ** 2;
}
