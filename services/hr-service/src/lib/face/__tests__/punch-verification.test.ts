import { describe, it, expect, vi } from 'vitest';
import { resolvePunchFace, FaceBlockedError, type FaceOutcome } from '../punch-verification';
import { FaceServiceUnavailableError, type FaceVerificationDriver, type FaceVerifyResult } from '../driver';

// Minimal driver whose verify() is scripted per test. enroll/delete/health are
// never exercised by the punch flow.
function mockDriver(verify: (subjectId: string, image: Buffer, threshold: number) => Promise<FaceVerifyResult>): FaceVerificationDriver {
  return {
    enrollSubject: vi.fn(async () => {}),
    deleteSubject: vi.fn(async () => {}),
    verify: vi.fn(verify),
    healthCheck: vi.fn(async () => true),
  };
}

const PHOTO = Buffer.from('probe');
const THRESHOLD = 85;

// ── The decision matrix: (enrolled?, score vs threshold, flag/block, service up?) ──
describe('resolvePunchFace decision matrix', () => {
  it('not enrolled + block → FaceBlockedError(FACE_NOT_ENROLLED), driver untouched', async () => {
    const driver = mockDriver(async () => ({ score: 0, matched: false }));
    await expect(
      resolvePunchFace({ driver, subjectId: null, photo: PHOTO, rules: { threshold: THRESHOLD, action: 'block' } }),
    ).rejects.toMatchObject({ code: 'FACE_NOT_ENROLLED' });
    expect(driver.verify).not.toHaveBeenCalled();
  });

  it('not enrolled + flag → pending review, no manager notify, driver untouched', async () => {
    const driver = mockDriver(async () => ({ score: 0, matched: false }));
    const out = await resolvePunchFace({
      driver,
      subjectId: null,
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false });
    expect(driver.verify).not.toHaveBeenCalled();
  });

  it('score >= threshold → passed, no review (block action)', async () => {
    const driver = mockDriver(async () => ({ score: 91, matched: true }));
    const out = await resolvePunchFace({
      driver,
      subjectId: 'u1',
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'block' },
    });
    expect(out).toEqual<FaceOutcome>({ score: 91, passed: true, reviewStatus: null, notifyManager: false });
  });

  it('score >= threshold → passed, no review (flag action)', async () => {
    const driver = mockDriver(async () => ({ score: 88, matched: true }));
    const out = await resolvePunchFace({
      driver,
      subjectId: 'u1',
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: 88, passed: true, reviewStatus: null, notifyManager: false });
  });

  it('score < threshold + block → FaceBlockedError(FACE_MISMATCH) carrying score + threshold', async () => {
    const driver = mockDriver(async () => ({ score: 42, matched: false }));
    await expect(
      resolvePunchFace({ driver, subjectId: 'u1', photo: PHOTO, rules: { threshold: THRESHOLD, action: 'block' } }),
    ).rejects.toMatchObject({ code: 'FACE_MISMATCH', details: { score: 42, threshold: 85 } });
  });

  it('score < threshold + flag → recorded (passed=false), pending review, notify manager', async () => {
    const driver = mockDriver(async () => ({ score: 42, matched: false }));
    const out = await resolvePunchFace({
      driver,
      subjectId: 'u1',
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: 42, passed: false, reviewStatus: 'pending', notifyManager: true });
  });

  // Fail-open: an outage NEVER rejects the punch — not even in block mode.
  it('service UNAVAILABLE + block → pending review, punch NOT rejected', async () => {
    const driver = mockDriver(async () => {
      throw new FaceServiceUnavailableError('timeout');
    });
    const out = await resolvePunchFace({
      driver,
      subjectId: 'u1',
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'block' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false });
  });

  it('service UNAVAILABLE + flag → pending review, punch NOT rejected', async () => {
    const driver = mockDriver(async () => {
      throw new FaceServiceUnavailableError('5xx');
    });
    const out = await resolvePunchFace({
      driver,
      subjectId: 'u1',
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'flag' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false });
  });

  it('an unexpected driver error also fails open (never loses the punch)', async () => {
    const driver = mockDriver(async () => {
      throw new Error('kaboom');
    });
    const out = await resolvePunchFace({
      driver,
      subjectId: 'u1',
      photo: PHOTO,
      rules: { threshold: THRESHOLD, action: 'block' },
    });
    expect(out).toEqual<FaceOutcome>({ score: null, passed: null, reviewStatus: 'pending', notifyManager: false });
  });

  it('FaceBlockedError is a real Error subclass with the code preserved', () => {
    const err = new FaceBlockedError('FACE_MISMATCH', { score: 10, threshold: 85 });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('FACE_MISMATCH');
    expect(err.details).toEqual({ score: 10, threshold: 85 });
  });
});
