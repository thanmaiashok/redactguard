import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanDocx } from './docx/index.js';
import { sniffImage } from './image/analyze.js';
import { scanImage } from './image/index.js';
import { scanPdf } from './pdf/index.js';
import { type FileKind, type ScanReport, ScanError } from './types.js';

/** Detects the file type from its first bytes (never trusts the extension). */
export function sniffKind(bytes: Uint8Array): FileKind {
  if (sniffImage(bytes)) return 'image';
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(
      'word/document.xml',
    )
      ? 'docx'
      : 'unknown';
  }
  return 'unknown';
}

export async function scanBytes(bytes: Uint8Array, file = '(buffer)'): Promise<ScanReport> {
  try {
    return await scanByKind(bytes, file);
  } catch (err) {
    if (err instanceof ScanError) throw err;
    // Never crash on a strange file: report it. Tests assert this path is never hit.
    throw new ScanError(
      `Unexpected problem while reading ${path.basename(file)}: ${(err as Error)?.message ?? String(err)}`,
      'INTERNAL',
      { cause: err },
    );
  }
}

async function scanByKind(bytes: Uint8Array, file: string): Promise<ScanReport> {
  const kind = sniffKind(bytes);
  switch (kind) {
    case 'pdf':
      return scanPdf(bytes, file);
    case 'docx':
      return scanDocx(bytes, file);
    case 'image':
      return scanImage(bytes, file);
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
