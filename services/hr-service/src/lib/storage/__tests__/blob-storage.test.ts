import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBlobStorage, detectImageExt, contentTypeForKey } from '@platform/blob-storage';

// The shared store is what both hr-service (punch selfies) and identity-service
// (avatars) write to. These lock the path-traversal guard, the deterministic
// putAt key, and the idempotent delete — the invariants the retention job and
// the enroll-reads-avatar flow both depend on.
describe('@platform/blob-storage local driver', () => {
  let dir: string;
  let store: ReturnType<typeof createBlobStorage>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blob-test-'));
    store = createBlobStorage({ driver: 'local', dir });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('putAt stores at the exact key and get round-trips the bytes', async () => {
    const key = 'punch/user-1/20260725_chkin.jpg';
    const bytes = Buffer.from([1, 2, 3, 4]);
    expect(await store.putAt(key, bytes)).toBe(key);
    expect(await store.exists(key)).toBe(true);
    expect(await store.get(key)).toEqual(bytes);
  });

  it('get returns null for a missing key (not a throw)', async () => {
    expect(await store.get('avatar/nope/1.jpg')).toBeNull();
    expect(await store.exists('avatar/nope/1.jpg')).toBe(false);
  });

  it('delete is idempotent — deleting a missing key does not throw', async () => {
    await store.putAt('punch/u/20260101_chkout.jpg', Buffer.from([9]));
    await store.delete('punch/u/20260101_chkout.jpg');
    expect(await store.exists('punch/u/20260101_chkout.jpg')).toBe(false);
    await expect(store.delete('punch/u/20260101_chkout.jpg')).resolves.toBeUndefined();
  });

  it('rejects keys that escape the storage root', async () => {
    for (const bad of ['../secret.jpg', 'punch/../../etc/passwd', '/abs/path.jpg']) {
      await expect(store.putAt(bad, Buffer.from([0]))).rejects.toThrow();
      await expect(store.get(bad)).rejects.toThrow();
    }
    // The traversal attempt must not have created anything outside the root.
    await expect(fs.access(path.join(dir, '..', 'secret.jpg'))).rejects.toThrow();
  });

  it('put generates a prefixed random key', async () => {
    const key = await store.put(Buffer.from([1]), 'jpg', 'punch');
    expect(key).toMatch(/^punch\/[0-9a-f-]{36}\.jpg$/);
    expect(await store.exists(key)).toBe(true);
  });
});

describe('image helpers', () => {
  it('detectImageExt sniffs jpg / png / webp, defaults to jpg', () => {
    expect(detectImageExt(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('jpg');
    expect(detectImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe('png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
    expect(detectImageExt(webp)).toBe('webp');
    expect(detectImageExt(Buffer.from([0, 1, 2]))).toBe('jpg');
  });

  it('contentTypeForKey maps extensions', () => {
    expect(contentTypeForKey('avatar/u/1.jpg')).toBe('image/jpeg');
    expect(contentTypeForKey('avatar/u/1.png')).toBe('image/png');
    expect(contentTypeForKey('avatar/u/1.webp')).toBe('image/webp');
    expect(contentTypeForKey('avatar/u/1.bin')).toBe('application/octet-stream');
  });
});
