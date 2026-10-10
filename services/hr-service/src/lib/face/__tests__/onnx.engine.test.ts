import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, it, expect, beforeAll } from 'vitest';
import { MODEL_VERSION, OnnxFaceEngine } from '../onnx.engine';
import { FaceEnrollmentError, FaceServiceUnavailableError, type FaceTemplate } from '../driver';

// Runs the REAL models (services/hr-service/models). Fixtures are generated
// here — no personal photos live in the repo. The face-positive path is covered
// by the calibration run (scripts/face-calibrate.ts) on consented photos.
const MODELS_DIR = path.resolve(__dirname, '../../../../models');
const engine = new OnnxFaceEngine(MODELS_DIR);
const TEMPLATE: FaceTemplate = { modelVersion: MODEL_VERSION, embedding: new Float32Array(128).fill(1 / Math.sqrt(128)) };

let blank: Buffer;
let noise: Buffer;

beforeAll(async () => {
  blank = await sharp({ create: { width: 480, height: 640, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
  const raw = Buffer.alloc(320 * 320 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  noise = await sharp(raw, { raw: { width: 320, height: 320, channels: 3 } }).png().toBuffer();
});

describe('OnnxFaceEngine (real models)', () => {
  it('enroll: a faceless photo is rejected as no_face (client error, not an outage)', async () => {
    await expect(engine.enroll(blank)).rejects.toBeInstanceOf(FaceEnrollmentError);
    await expect(engine.enroll(noise)).rejects.toMatchObject({ reason: 'no_face' });
  });

  it('enroll: bytes that are not an image are rejected as no_face', async () => {
    await expect(engine.enroll(Buffer.from('definitely not a jpeg'))).rejects.toMatchObject({ reason: 'no_face' });
  });

  it('verify: a faceless probe scores 0 with empty diagnostics', async () => {
    const r = await engine.verify(TEMPLATE, blank, 85);
    expect(r).toEqual({
      score: 0,
      matched: false,
      diagnostics: { similarity: null, liveness: null, det_score: null, model_version: MODEL_VERSION },
    });
  });

  it('verify: an undecodable probe scores 0 (never throws)', async () => {
    const r = await engine.verify(TEMPLATE, Buffer.from([0xff, 0xd8, 0x00]), 85);
    expect(r.score).toBe(0);
  });

  it('verify: a template from another model is UNAVAILABLE (fail open), never compared', async () => {
    await expect(engine.verify({ ...TEMPLATE, modelVersion: 'other-model' }, blank, 85)).rejects.toBeInstanceOf(
      FaceServiceUnavailableError,
    );
  });

  it('a model file that fails its SHA-256 pin makes the engine UNAVAILABLE', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'face-models-'));
    for (const f of [
      'face_detection_yunet_2023mar.onnx',
      'face_recognition_sface_2021dec.onnx',
      'minifasnet_v2_2.7_80x80.onnx',
      'minifasnet_v1se_4.0_80x80.onnx',
    ]) {
      writeFileSync(path.join(dir, f), 'tampered');
    }
    const bad = new OnnxFaceEngine(dir);
    await expect(bad.verify(TEMPLATE, blank, 85)).rejects.toBeInstanceOf(FaceServiceUnavailableError);
    await expect(bad.enroll(blank)).rejects.toBeInstanceOf(FaceServiceUnavailableError);
  });

  it('a missing models directory makes the engine UNAVAILABLE', async () => {
    const bad = new OnnxFaceEngine(path.join(os.tmpdir(), 'no-such-face-models-dir'));
    await expect(bad.verify(TEMPLATE, blank, 85)).rejects.toBeInstanceOf(FaceServiceUnavailableError);
  });
});
