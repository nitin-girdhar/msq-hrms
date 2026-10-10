import { describe, it, expect, vi } from 'vitest';
import { resolvePunchFace, FaceBlockedError, type FaceOutcome } from '../punch-verification';
import {
  FaceServiceUnavailableError,
  type FaceDiagnostics,
  type FaceEngine,
  type FaceTemplate,
  type FaceVerifyResult,
} from '../driver';

// Minimal engine whose verify() is scripted per test. enroll is never exercised
// by the punch flow.
function mockEngine(verify: (template: FaceTemplate, image: Buffer, threshold: number) => Promise<FaceVerifyResult>): FaceEngine {
  return {
    enroll: vi.fn(async () => {
      throw new Error('not used');
    }),
    verify: vi.fn(verify),
  };
}

const DIAG: FaceDiagnostics = { similarity: 0.5, liveness: 0.9, det_score: 0.95, model_version: 'test' };
const result = (score: number, matched: boolean): FaceVerifyResult => ({ score, matched, diagnostics: DIAG });
const TEMPLATE: FaceTemplate = { modelVersion: 'test', embedding: new Float32Array(128) };
const PHOTO = Buffer.from('probe');
const THRESHOLD = 85;

// ── The decision matrix: (enrolled?, score vs threshold, flag/block, service up?) ──
describe('resolvePunchFace decision matrix', () => {
  it('not enrolled + block → FaceBlockedError(FACE_NOT_ENROLLED), engine untouched', async () => {
    const engine = mockEngine(async () => result(0, false));
    await expect(
      resolvePunchFace({ engine, template: null, photo: PHOTO, rules: { threshold: THRESHOLD, action: 'block' } }),
    ).rejects.toMatchObject({ code: 'FACE_NOT_ENROLLED' });
    expect(engine.verify).not.toHaveBeenCalled();
  });

  it('not enrolled + flag → pending review, no manager notify, engine untouched', async () => {
    const engine = mockEngine(async () => result(0, false));
    const out = await resolvePunchFace({
      engine,
      template: null,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false, diagnostics: null });
    expect(engine.verify).not.toHaveBeenCalled();
  });

  it('score >= threshold → passed, no review (block action)', async () => {
    const engine = mockEngine(async () => result(91, true));
    const out = await resolvePunchFace({
      engine,
      template: TEMPLATE,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'block' },
    });
    expect(out).toEqual<FaceOutcome>({ score: 91, passed: true, reviewStatus: null, notifyManager: false, diagnostics: DIAG });
  });

  it('score >= threshold → passed, no review (flag action)', async () => {
    const engine = mockEngine(async () => result(88, true));
    const out = await resolvePunchFace({
      engine,
      template: TEMPLATE,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: 88, passed: true, reviewStatus: null, notifyManager: false, diagnostics: DIAG });
  });

  it('score < threshold + block → FaceBlockedError(FACE_MISMATCH) carrying score + threshold', async () => {
    const engine = mockEngine(async () => result(42, false));
    await expect(
      resolvePunchFace({ engine, template: TEMPLATE, photo: PHOTO, rules: { threshold: THRESHOLD, action: 'block' } }),
    ).rejects.toMatchObject({ code: 'FACE_MISMATCH', details: { score: 42, threshold: 85 } });
  });

  it('score < threshold + flag → recorded (passed=false), pending review, notify manager', async () => {
    const engine = mockEngine(async () => result(42, false));
    const out = await resolvePunchFace({
      engine,
      template: TEMPLATE,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: 42, passed: false, reviewStatus: 'pending', notifyManager: true, diagnostics: DIAG });
  });

  // Fail-open: an outage NEVER rejects the punch — not even in block mode.
  it('service UNAVAILABLE + block → pending review, punch NOT rejected', async () => {
    const engine = mockEngine(async () => {
      throw new FaceServiceUnavailableError('timeout');
    });
    const out = await resolvePunchFace({
      engine,
      template: TEMPLATE,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'block' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false, diagnostics: null });
  });

  it('service UNAVAILABLE + flag → pending review, punch NOT rejected', async () => {
    const engine = mockEngine(async () => {
      throw new FaceServiceUnavailableError('5xx');
    });
    const out = await resolvePunchFace({
      engine,
      template: TEMPLATE,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false, diagnostics: null });
  });

  it('an unexpected engine error also fails open (never loses the punch)', async () => {
    const engine = mockEngine(async () => {
      throw new Error('kaboom');
    });
    const out = await resolvePunchFace({
      engine,
      template: TEMPLATE,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'block' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false, diagnostics: null });
  });

  it('FaceBlockedError is a real Error subclass with the code preserved', () => {
    const err = new FaceBlockedError('FACE_MISMATCH', { score: 10, threshold: 85 });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('FACE_MISMATCH');
    expect(err.details).toEqual({ score: 10, threshold: 85 });
  });
});
