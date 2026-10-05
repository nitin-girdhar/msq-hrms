import { describe, it, expect } from 'vitest';
import { buildZip, crc32, uniqueNames } from '../zip.js';

describe('zip', () => {
  it('crc32 matches the known check value', () => expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926));

  it('writes a readable archive: signatures, counts, stored bytes', () => {
    const z = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'b.txt', data: Buffer.from('world!') }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    const eocd = z.length - 22;
    expect(z.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(z.readUInt16LE(eocd + 10)).toBe(2);
    const cdOffset = z.readUInt32LE(eocd + 16);
    expect(z.readUInt32LE(cdOffset)).toBe(0x02014b50);
    expect(z.subarray(35, 40).toString()).toBe('hello');
    expect(z.readUInt32LE(14)).toBe(crc32(Buffer.from('hello')));
  });

  it('flattens path tricks and de-duplicates names', () => {
    expect(uniqueNames(['../../etc/passwd'])[0]).not.toMatch(/[\\/]/);
    expect(uniqueNames(['a.pdf', 'A.pdf', 'a.pdf'])).toEqual(['a.pdf', 'A (2).pdf', 'a (3).pdf']);
  });
});
