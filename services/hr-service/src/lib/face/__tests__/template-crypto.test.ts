import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { decryptTemplate, encryptTemplate } from '../template-crypto';
import { FaceServiceUnavailableError, type FaceTemplate } from '../driver';

const KEY_HEX = crypto.randomBytes(32).toString('hex');
const KEY_B64 = crypto.randomBytes(32).toString('base64');

function template(): FaceTemplate {
  const embedding = new Float32Array(128);
  for (let i = 0; i < embedding.length; i++) embedding[i] = Math.sin(i) / 8;
  return { modelVersion: 'sface-2021dec+yunet-2023mar', embedding };
}

describe('template-crypto', () => {
  it('round-trips the model version and every float exactly (hex key)', () => {
    const t = template();
    const back = decryptTemplate(encryptTemplate(t, KEY_HEX), KEY_HEX);
    expect(back.modelVersion).toBe(t.modelVersion);
    expect(Array.from(back.embedding)).toEqual(Array.from(t.embedding));
  });

  it('accepts a base64 key', () => {
    const t = template();
    expect(decryptTemplate(encryptTemplate(t, KEY_B64), KEY_B64).embedding.length).toBe(128);
  });

  it('never stores plaintext: output is the enc:v1 envelope and differs per call (random IV)', () => {
    const t = template();
    const a = encryptTemplate(t, KEY_HEX);
    const b = encryptTemplate(t, KEY_HEX);
    expect(a.startsWith('enc:v1:')).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('sface');
  });

  it('a wrong key fails as UNAVAILABLE (fail-open path), not as a crash', () => {
    const enc = encryptTemplate(template(), KEY_HEX);
    expect(() => decryptTemplate(enc, crypto.randomBytes(32).toString('hex'))).toThrow(FaceServiceUnavailableError);
  });

  it('tampered ciphertext is rejected by the GCM tag', () => {
    const enc = encryptTemplate(template(), KEY_HEX);
    const parts = enc.split(':');
    const ct = Buffer.from(parts[4]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64');
    expect(() => decryptTemplate(parts.join(':'), KEY_HEX)).toThrow(FaceServiceUnavailableError);
  });

  it('fails CLOSED with no key: refuses to encrypt or decrypt', () => {
    expect(() => encryptTemplate(template(), '')).toThrow(FaceServiceUnavailableError);
    expect(() => decryptTemplate('enc:v1:a:b:c', '')).toThrow(FaceServiceUnavailableError);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptTemplate(template(), 'abcd')).toThrow(/32 bytes/);
  });

  it('refuses a value that is not in the encrypted envelope', () => {
    expect(() => decryptTemplate('{"m":"x","v":""}', KEY_HEX)).toThrow(FaceServiceUnavailableError);
  });
});
