// ─────────────────────────────────────────────────────────────────────────────
// Face templates at rest: AES-256-GCM, key from FACE_TEMPLATE_KEY.
//
// An embedding is biometric data (DPDP), so hr.face_templates.embedding_enc only
// ever holds ciphertext:
//   enc:v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
// (the same envelope as meta-conversion-api's lib/crypto.ts). Unlike that helper
// this one FAILS CLOSED: with no key configured it refuses to encrypt or decrypt
// rather than storing plaintext. The plaintext is the model version and the
// float32 vector, so a template can never be replayed against a different model.
//
// Losing the key makes every stored template unreadable: verification then fails
// open (pending review) and employees must re-enroll. Back the key up.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { FaceServiceUnavailableError, type FaceTemplate } from './driver.js';

const ENC_PREFIX = 'enc:v1:';

export function parseTemplateKey(raw: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new FaceServiceUnavailableError('FACE_TEMPLATE_KEY must decode to 32 bytes (64 hex chars or base64)');
  }
  return key;
}

function requireKey(raw: string): Buffer {
  if (!raw) throw new FaceServiceUnavailableError('FACE_TEMPLATE_KEY is not configured');
  return parseTemplateKey(raw);
}

export function encryptTemplate(template: FaceTemplate, rawKey: string): string {
  const key = requireKey(rawKey);
  const vec = Buffer.from(template.embedding.buffer, template.embedding.byteOffset, template.embedding.byteLength);
  const plaintext = Buffer.from(
    JSON.stringify({ m: template.modelVersion, v: vec.toString('base64') }),
    'utf-8',
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptTemplate(value: string, rawKey: string): FaceTemplate {
  const key = requireKey(rawKey);
  if (!value.startsWith(ENC_PREFIX)) throw new FaceServiceUnavailableError('face template is not encrypted');
  const parts = value.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new FaceServiceUnavailableError('malformed face template ciphertext');
  try {
    const [iv, tag, ct] = parts.map((p) => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
    const parsed = JSON.parse(plain) as { m: string; v: string };
    const bytes = Buffer.from(parsed.v, 'base64');
    // Copy into a fresh, aligned buffer: Float32Array needs a 4-byte-aligned offset.
    const embedding = new Float32Array(bytes.byteLength / 4);
    new Uint8Array(embedding.buffer).set(bytes);
    return { modelVersion: parsed.m, embedding };
  } catch {
    throw new FaceServiceUnavailableError('face template could not be decrypted (wrong FACE_TEMPLATE_KEY?)');
  }
}
