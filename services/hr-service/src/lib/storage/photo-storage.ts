// ─────────────────────────────────────────────────────────────────────────────
// Photo storage abstraction for attendance punch selfies.
//
// No object-storage infra existed in the repo, so this is the minimal
// production-sane option: an env-selectable driver behind a small interface. The
// `local` driver writes to a Docker-volume-backed directory; an `s3` driver can be
// dropped in later without touching call sites. Photos are NEVER served from a
// public static dir — the attendance router re-serves them through an
// authenticated GET route after an authority check.
//
// Keys are opaque, service-generated relative paths (e.g. `att/<uuid>.jpg`). The
// local driver refuses any key that escapes the base directory (path-traversal
// guard) so a stored key can be echoed back into `get()` safely.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../../config/index.js';

export interface PhotoStorage {
  /** Persist bytes; returns the opaque storage key. */
  put(data: Buffer, ext: string): Promise<string>;
  /** Fetch bytes by key, or null if not found. */
  get(key: string): Promise<Buffer | null>;
  /** True if a key exists. */
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

/** Map a stored key's extension to a Content-Type for the authenticated GET route. */
export function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/** Sniff a supported image type from magic bytes; defaults to jpg. */
export function detectImageExt(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return 'jpg';
}

class LocalPhotoStorage implements PhotoStorage {
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.baseDir, key);
    const base = path.resolve(this.baseDir);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error(`Key escapes storage root: ${key}`);
    }
    return full;
  }

  async put(data: Buffer, ext: string): Promise<string> {
    const safeExt = ext.replace(/[^a-z0-9]/gi, '') || 'bin';
    const key = `att/${randomUUID()}.${safeExt}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

let singleton: PhotoStorage | null = null;

/** The configured photo store (env-selected). Currently only the local driver
 *  ships; `s3` is reserved for a future increment. */
export function getPhotoStorage(): PhotoStorage {
  if (singleton) return singleton;
  switch (config.photoStorageDriver) {
    case 'local':
      singleton = new LocalPhotoStorage(config.photoStorageDir);
      return singleton;
    default:
      throw new Error(`Unsupported PHOTO_STORAGE_DRIVER: ${config.photoStorageDriver}`);
  }
}
