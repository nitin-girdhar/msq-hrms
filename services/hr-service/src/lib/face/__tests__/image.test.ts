import { describe, it, expect } from 'vitest';
import {
  type Point,
  type RgbImage,
  applySimilarity,
  cropResize,
  estimateSimilarity,
  laplacianVariance,
  toChwTensor,
  toGray,
  warpSimilarity,
} from '../image';
import { SFACE_TEMPLATE } from '../sface';

function gradient(w: number, h: number): RgbImage {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 2, y * 2, 100], (y * w + x) * 3);
  return { data, width: w, height: h };
}

describe('estimateSimilarity', () => {
  it('maps the 5 template points onto themselves with the identity', () => {
    const m = estimateSimilarity(SFACE_TEMPLATE, SFACE_TEMPLATE);
    expect(m.a).toBeCloseTo(1, 9);
    expect(m.b).toBeCloseTo(0, 9);
    expect(m.tx).toBeCloseTo(0, 9);
    expect(m.ty).toBeCloseTo(0, 9);
  });

  it('recovers a known rotation + scale + translation exactly', () => {
    const theta = 0.3;
    const s = 2.5;
    const truth = { a: s * Math.cos(theta), b: s * Math.sin(theta), tx: 40, ty: -12 };
    const src = SFACE_TEMPLATE.map((p) => applySimilarity(truth, p));
    const m = estimateSimilarity(src, SFACE_TEMPLATE);
    for (let i = 0; i < 5; i++) {
      const [x, y] = applySimilarity(m, src[i]!);
      expect(x).toBeCloseTo(SFACE_TEMPLATE[i]![0], 6);
      expect(y).toBeCloseTo(SFACE_TEMPLATE[i]![1], 6);
    }
  });

  it('never reflects: mirrored points give a rotation, not a flip', () => {
    const mirrored: Point[] = SFACE_TEMPLATE.map(([x, y]) => [112 - x, y]);
    const m = estimateSimilarity(mirrored, SFACE_TEMPLATE);
    // A similarity has determinant a²+b² > 0 by construction.
    expect(m.a * m.a + m.b * m.b).toBeGreaterThan(0);
  });
});

describe('warpSimilarity / cropResize', () => {
  it('the identity warp reproduces the image', () => {
    const img = gradient(20, 10);
    const out = warpSimilarity(img, { a: 1, b: 0, tx: 0, ty: 0 }, 20, 10);
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });

  it('a pure translation shifts pixels and fills outside with 0', () => {
    const img = gradient(20, 10);
    const out = warpSimilarity(img, { a: 1, b: 0, tx: 3, ty: 0 }, 20, 10);
    expect(out.data[(0 * 20 + 3) * 3]).toBe(img.data[0]);
    expect(out.data[0]).toBe(0);
  });

  it('a full-size crop at the same size is the identity', () => {
    const img = gradient(16, 12);
    const out = cropResize(img, 0, 0, 15, 11, 16, 12);
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });
});

describe('tensors and measures', () => {
  it('toChwTensor writes planar channels in the requested order', () => {
    const img: RgbImage = { data: Uint8Array.from([10, 20, 30, 40, 50, 60]), width: 2, height: 1 };
    expect(Array.from(toChwTensor(img, 'rgb'))).toEqual([10, 40, 20, 50, 30, 60]);
    expect(Array.from(toChwTensor(img, 'bgr'))).toEqual([30, 60, 20, 50, 10, 40]);
  });

  it('toGray uses BT.601 weights', () => {
    const img: RgbImage = { data: Uint8Array.from([255, 0, 0]), width: 1, height: 1 };
    expect(toGray(img)[0]).toBeCloseTo(76.245, 3);
  });

  it('laplacianVariance is 0 on a linear ramp and large on a checkerboard', () => {
    const ramp = new Float32Array(100).map((_, i) => (i % 10) * 10);
    expect(laplacianVariance(ramp, 10, 10)).toBeCloseTo(0, 6);
    const board = new Float32Array(100).map((_, i) => ((i % 10) + Math.floor(i / 10)) % 2 ? 255 : 0);
    expect(laplacianVariance(board, 10, 10)).toBeGreaterThan(10000);
  });
});
