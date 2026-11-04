import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api.js';
import { ScanError } from '../types.js';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const require = createRequire(import.meta.url);
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));

let pdfjsPromise: Promise<Pdfjs> | undefined;

export function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * Serves fonts, cmaps and wasm from the local pdfjs-dist folder.
 * Replaces pdfjs' default loader so nothing can ever be fetched from a URL.
 */
class LocalDataFactory {
  private dirs: Record<string, string>;
  constructor() {
    this.dirs = {
      cMapUrl: path.join(PDFJS_DIR, 'cmaps'),
      standardFontDataUrl: path.join(PDFJS_DIR, 'standard_fonts'),
      wasmUrl: path.join(PDFJS_DIR, 'wasm'),
    };
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const dir = this.dirs[kind];
    if (!dir || filename.includes('..') || path.isAbsolute(filename)) {
      throw new Error(`redactguard: refusing to load pdf.js data ${kind}/${filename}`);
    }
    return new Uint8Array(await readFile(path.join(dir, filename)));
  }
}

export interface LoadedPdf {
  pdfjs: Pdfjs;
  doc: PDFDocumentProxy;
  /** Original bytes (pdf.js may detach the buffer it was given). */
  bytes: Uint8Array;
}

export async function openPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const pdfjs = await loadPdfjs();
  const copy = bytes.slice();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    // Offline + safe settings.
    BinaryDataFactory: LocalDataFactory,
    cMapUrl: 'local/',
    cMapPacked: true,
    standardFontDataUrl: 'local/',
    wasmUrl: 'local/',
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    // Never ask for a password; encrypted-with-password files are reported as such.
  } as Parameters<Pdfjs['getDocument']>[0]);
  try {
    const doc = await task.promise;
    return { pdfjs, doc, bytes: copy };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') {
      throw new ScanError(
        'This PDF is password-protected. Open it, remove the password and scan again.',
        'ENCRYPTED',
        { cause: err },
      );
    }
    throw new ScanError(
      `Could not read PDF: ${(err as Error)?.message ?? String(err)}`,
      'MALFORMED',
      {
        cause: err,
      },
    );
  }
}
