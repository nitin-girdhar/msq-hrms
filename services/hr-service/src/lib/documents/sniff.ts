// What an uploaded document really is, decided from its leading bytes. The client's file
// name and content-type are never trusted: a renamed .exe must not be stored as a "PDF".
export interface DocumentKind {
  mime: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'pdf' | 'jpg' | 'png' | 'webp';
}

export function sniffDocument(b: Buffer): DocumentKind | null {
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
