import { describe, it, expect, vi } from 'vitest';
import { ComprefaceDriver, normalizeSimilarity } from '../compreface.driver';
import { FaceServiceUnavailableError, FaceEnrollmentError } from '../driver';

// Build a driver over a mocked fetch. Default timeout is generous; individual
// tests override it (e.g. the timeout case uses a tiny value).
function makeDriver(fetchFn: typeof fetch, timeoutMs = 5000) {
  return new ComprefaceDriver('http://compreface-api:8000', 'test-key', timeoutMs, fetchFn);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('normalizeSimilarity (0–1 → 0–100)', () => {
  it('maps the endpoints and midpoints', () => {
    expect(normalizeSimilarity(0)).toBe(0);
    expect(normalizeSimilarity(1)).toBe(100);
    expect(normalizeSimilarity(0.855)).toBe(85.5);
    expect(normalizeSimilarity(0.9234)).toBe(92.34);
  });
  it('clamps out-of-range values', () => {
    expect(normalizeSimilarity(1.5)).toBe(100);
    expect(normalizeSimilarity(-0.2)).toBe(0);
  });
});

describe('ComprefaceDriver.verify', () => {
  it('normalizes the matching subject similarity to 0–100 and matches at threshold', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ result: [{ subjects: [{ subject: 'u1', similarity: 0.92 }] }] }),
    ) as unknown as typeof fetch;
    const driver = makeDriver(fetchFn);
    const res = await driver.verify('u1', Buffer.from('x'), 85);
    expect(res).toEqual({ score: 92, matched: true });
  });

  it('reports a mismatch when the best similarity is below threshold', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ result: [{ subjects: [{ subject: 'u1', similarity: 0.4 }] }] }),
    ) as unknown as typeof fetch;
    const res = await makeDriver(fetchFn).verify('u1', Buffer.from('x'), 85);
    expect(res).toEqual({ score: 40, matched: false });
  });

  it('scores 0 when the probe subject is absent from the results', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ result: [{ subjects: [{ subject: 'someone-else', similarity: 0.99 }] }] }),
    ) as unknown as typeof fetch;
    const res = await makeDriver(fetchFn).verify('u1', Buffer.from('x'), 85);
    expect(res).toEqual({ score: 0, matched: false });
  });

  it('treats "no face found" (400 code 28) as score 0, NOT unavailable', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ code: 28, message: 'No face is found' }, 400)) as unknown as typeof fetch;
    const res = await makeDriver(fetchFn).verify('u1', Buffer.from('x'), 85);
    expect(res).toEqual({ score: 0, matched: false });
  });

  it('maps a 5xx to FaceServiceUnavailableError', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'boom' }, 502)) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).verify('u1', Buffer.from('x'), 85)).rejects.toBeInstanceOf(
      FaceServiceUnavailableError,
    );
  });

  it('maps a transport failure to FaceServiceUnavailableError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).verify('u1', Buffer.from('x'), 85)).rejects.toBeInstanceOf(
      FaceServiceUnavailableError,
    );
  });

  it('aborts after the timeout and reports UNAVAILABLE', async () => {
    // fetch that never resolves until its signal aborts.
    const fetchFn = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const driver = makeDriver(fetchFn, 10);
    await expect(driver.verify('u1', Buffer.from('x'), 85)).rejects.toBeInstanceOf(FaceServiceUnavailableError);
  });
});

describe('ComprefaceDriver.enrollSubject', () => {
  it('resolves on a 2xx', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ image_id: 'abc' }, 201)) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).enrollSubject('u1', Buffer.from('x'))).resolves.toBeUndefined();
  });

  it('raises FaceEnrollmentError when the reference photo has no face', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ code: 28, message: 'No face is found' }, 400)) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).enrollSubject('u1', Buffer.from('x'))).rejects.toBeInstanceOf(
      FaceEnrollmentError,
    );
  });

  it('raises FaceServiceUnavailableError on a 5xx', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'boom' }, 503)) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).enrollSubject('u1', Buffer.from('x'))).rejects.toBeInstanceOf(
      FaceServiceUnavailableError,
    );
  });
});

describe('ComprefaceDriver.deleteSubject', () => {
  it('is idempotent: a 404 resolves without throwing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'not found' }, 404)) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).deleteSubject('u1')).resolves.toBeUndefined();
  });

  it('resolves on a 2xx', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ deleted: 1 }, 200)) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).deleteSubject('u1')).resolves.toBeUndefined();
  });

  it('throws UNAVAILABLE on a 5xx', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    await expect(makeDriver(fetchFn).deleteSubject('u1')).rejects.toBeInstanceOf(FaceServiceUnavailableError);
  });
});

describe('ComprefaceDriver.healthCheck', () => {
  it('returns true on 200 and false on error', async () => {
    const ok = makeDriver(vi.fn(async () => jsonResponse({ subjects: [] })) as unknown as typeof fetch);
    expect(await ok.healthCheck()).toBe(true);
    const bad = makeDriver(vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch);
    expect(await bad.healthCheck()).toBe(false);
  });
});
