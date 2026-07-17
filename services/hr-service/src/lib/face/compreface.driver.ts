// ─────────────────────────────────────────────────────────────────────────────
// CompreFace (Exadel) implementation of FaceVerificationDriver.
//
// Uses the Recognition service REST API (subject-based). One recognition
// "subject" per employee, keyed by the user's UUID:
//   enroll  → POST   /api/v1/recognition/faces?subject={id}   (add a reference face)
//   delete  → DELETE /api/v1/recognition/subjects/{id}        (drop subject + faces)
//   verify  → POST   /api/v1/recognition/recognize            (probe → ranked subjects)
//   health  → GET    /api/v1/recognition/subjects
//
// CompreFace returns similarity on a 0–1 scale; we normalize to 0–100 at this
// boundary. `matched` is computed here against the caller's threshold.
//
// Every call is bounded by a timeout (default 5s). Timeout, connection failure, or
// a 5xx/auth error is surfaced as FaceServiceUnavailableError so the punch flow can
// fail open. A probe image with no detectable face is NOT unavailable — it scores 0
// (verify) or raises FaceEnrollmentError (enroll).
// ─────────────────────────────────────────────────────────────────────────────

import {
  type FaceVerificationDriver,
  type FaceVerifyResult,
  FaceServiceUnavailableError,
  FaceEnrollmentError,
} from './driver.js';

// CompreFace "no face found in the given image" — code 28 in its error envelope.
const NO_FACE_CODE = 28;

type FetchFn = typeof fetch;

interface RecognizeResponse {
  result?: Array<{ subjects?: Array<{ subject: string; similarity: number }> }>;
}

export class ComprefaceDriver implements FaceVerificationDriver {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    // Injectable for unit tests; defaults to the global fetch.
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private fileForm(image: Buffer): FormData {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(image)]), 'photo.jpg');
    return form;
  }

  // Wraps fetch with an AbortController timeout. Any transport-level failure
  // (timeout/DNS/refused) becomes UNAVAILABLE — callers never see a raw fetch error.
  private async call(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: { 'x-api-key': this.apiKey, ...(init.headers ?? {}) },
      });
    } catch (err) {
      throw new FaceServiceUnavailableError(
        `CompreFace request failed: ${(err as Error).message ?? 'network error'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorBody(res: Response): Promise<{ code?: number; message?: string }> {
    try {
      return (await res.json()) as { code?: number; message?: string };
    } catch {
      return {};
    }
  }

  async enrollSubject(subjectId: string, image: Buffer): Promise<void> {
    const res = await this.call(
      `/api/v1/recognition/faces?subject=${encodeURIComponent(subjectId)}`,
      { method: 'POST', body: this.fileForm(image) },
    );
    if (res.ok) return;
    const body = await this.errorBody(res);
    if (res.status === 400 && (body.code === NO_FACE_CODE || /no face/i.test(body.message ?? ''))) {
      throw new FaceEnrollmentError('No detectable face in the reference photo');
    }
    throw new FaceServiceUnavailableError(`CompreFace enroll failed (${res.status})`);
  }

  async deleteSubject(subjectId: string): Promise<void> {
    const res = await this.call(`/api/v1/recognition/subjects/${encodeURIComponent(subjectId)}`, {
      method: 'DELETE',
    });
    // 404 → already gone; treat as success so unenroll is idempotent.
    if (res.ok || res.status === 404) return;
    throw new FaceServiceUnavailableError(`CompreFace delete-subject failed (${res.status})`);
  }

  async verify(subjectId: string, image: Buffer, thresholdPct: number): Promise<FaceVerifyResult> {
    // limit=0 → all detected faces; prediction_count high enough to include our subject.
    const res = await this.call(
      '/api/v1/recognition/recognize?limit=0&prediction_count=100',
      { method: 'POST', body: this.fileForm(image) },
    );

    if (!res.ok) {
      const body = await this.errorBody(res);
      // Probe has no detectable face → score 0 (a real mismatch, NOT unavailable).
      if (res.status === 400 && (body.code === NO_FACE_CODE || /no face/i.test(body.message ?? ''))) {
        return { score: 0, matched: false };
      }
      throw new FaceServiceUnavailableError(`CompreFace recognize failed (${res.status})`);
    }

    const json = (await res.json().catch(() => ({}))) as RecognizeResponse;
    // Best similarity for our subject across all detected faces in the probe.
    let best = 0;
    for (const face of json.result ?? []) {
      for (const s of face.subjects ?? []) {
        if (s.subject === subjectId && s.similarity > best) best = s.similarity;
      }
    }
    const score = normalizeSimilarity(best);
    return { score, matched: score >= thresholdPct };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.call('/api/v1/recognition/subjects', { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// CompreFace similarity is 0–1; map to 0–100 and clamp/round to 2 decimals to fit
// numeric(5,2). Exported for unit testing.
export function normalizeSimilarity(similarity: number): number {
  const pct = Math.max(0, Math.min(1, similarity)) * 100;
  return Math.round(pct * 100) / 100;
}
