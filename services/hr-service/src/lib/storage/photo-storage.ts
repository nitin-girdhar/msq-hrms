// ─────────────────────────────────────────────────────────────────────────────
// Thin adapter over the shared @platform/blob-storage store.
//
// Avatars (written by identity-service) and attendance selfies (written here)
// share ONE volume so hr-service can read a user's enrolled avatar for face
// verification without a network hop. This module keeps the historical
// `getPhotoStorage()` / `PhotoStorage` / `detectImageExt` / `contentTypeForKey`
// surface so existing attendance call sites are untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { BlobKeyError, assertKeyInTenant, createBlobStorage, type BlobStorage } from '@platform/blob-storage';
import { config } from '../../config/index.js';
import { ForbiddenError } from '../errors.js';

export type PhotoStorage = BlobStorage;
export { contentTypeForKey, detectImageExt } from '@platform/blob-storage';

/**
 * Throws ForbiddenError unless the stored `key` lives under `tenantId` (the verified
 * session's tenant — never from the request). Every authenticated read, serve or
 * delete of a stored key calls this IN ADDITION to the row-level checks that found
 * the key. Legacy tenant-less keys pass only while BLOB_ALLOW_LEGACY_KEYS is on.
 */
export function assertOwnKey(tenantId: string, key: string): void {
  try {
    assertKeyInTenant(key, tenantId, { allowLegacy: config.blobAllowLegacyKeys });
  } catch (err) {
    if (err instanceof BlobKeyError) throw new ForbiddenError('Forbidden');
    throw err;
  }
}

let singleton: PhotoStorage | null = null;

/** The configured photo store, shared with identity-service via one volume. */
export function getPhotoStorage(): PhotoStorage {
  if (singleton) return singleton;
  singleton = createBlobStorage({ driver: config.photoStorageDriver, dir: config.photoStorageDir });
  return singleton;
}
