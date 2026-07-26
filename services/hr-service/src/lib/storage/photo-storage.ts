// ─────────────────────────────────────────────────────────────────────────────
// Thin adapter over the shared @platform/blob-storage store.
//
// Avatars (written by identity-service) and attendance selfies (written here)
// share ONE volume so hr-service can read a user's enrolled avatar for face
// verification without a network hop. This module keeps the historical
// `getPhotoStorage()` / `PhotoStorage` / `detectImageExt` / `contentTypeForKey`
// surface so existing attendance call sites are untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { createBlobStorage, type BlobStorage } from '@platform/blob-storage';
import { config } from '../../config/index.js';

export type PhotoStorage = BlobStorage;
export { contentTypeForKey, detectImageExt } from '@platform/blob-storage';

let singleton: PhotoStorage | null = null;

/** The configured photo store, shared with identity-service via one volume. */
export function getPhotoStorage(): PhotoStorage {
  if (singleton) return singleton;
  singleton = createBlobStorage({ driver: config.photoStorageDriver, dir: config.photoStorageDir });
  return singleton;
}
