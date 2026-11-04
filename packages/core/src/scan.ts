import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanPdf } from './pdf/index.js';
import { type FileKind, type ScanReport, ScanError } from './types.js';

/** Detects the file type from its first bytes (never trusts the extension alone). */
export function sniffKind(bytes: Uint8Array): FileKind {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return Buffer.from(bytes).includes('word/document.xml') ? 'docx' : 'unknown';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image';
  if (
    head.slice(4, 8) === 'ftyp' &&
    /^(heic|heix|mif1|msf1|heim|heis|hevc|avif)/.test(head.slice(8, 12))
  )
    return 'image';
  return 'unknown';
}

export async function scanBytes(bytes: Uint8Array, file = '(buffer)'): Promise<ScanReport> {
  const kind = sniffKind(bytes);
  switch (kind) {
    case 'pdf':
      return scanPdf(bytes, file);
    default:
      throw new ScanError(
        `Unsupported file type for ${path.basename(file)}. redactguard scans PDF, DOCX, JPG, PNG, WebP and HEIC.`,
        'UNSUPPORTED',
      );
  }
}

export async function scanFile(filePath: string): Promise<ScanReport> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(filePath));
  } catch (err) {
    throw new ScanError(`Cannot read ${filePath}: ${(err as Error).message}`, 'IO', { cause: err });
  }
  return scanBytes(bytes, filePath);
}
