import { describe, it, expect } from 'vitest';
import { sniffDocument } from '../sniff.js';

describe('sniffDocument', () => {
  it('recognises a PDF', () => expect(sniffDocument(Buffer.from('%PDF-1.7\n...'))?.mime).toBe('application/pdf'));
  it('recognises a JPEG', () => expect(sniffDocument(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext).toBe('jpg'));
  it('recognises a PNG', () => expect(sniffDocument(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe('image/png'));
  it('recognises a WebP', () => expect(sniffDocument(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp'));
  it('refuses an executable renamed to .pdf', () => expect(sniffDocument(Buffer.from('MZ\x90\0\x03\0\0\0'))).toBeNull());
  it('refuses a script and an empty buffer', () => {
    expect(sniffDocument(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffDocument(Buffer.alloc(0))).toBeNull();
  });
  it('refuses an SVG (it can carry script)', () => expect(sniffDocument(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull());
});
