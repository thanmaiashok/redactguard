/**
 * Runs the image checks on every image drawn in a PDF: EXIF/GPS from the original JPEG bytes and
 * pixelation on the decoded pixels pdf.js already produced.
 */
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api.js';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, PDFRef } from 'pdf-lib';
import { pixelsFromPdfjs } from '../../image/decode.js';
import { analyzeImage } from '../../image/analyze.js';
import type { BBox } from '../../types.js';
import type { FindingSink } from '../../util.js';
import type { PageModel } from '../interpret.js';

export const MAX_PDF_IMAGES = 200;

/** Lazily-parsed pdf-lib view of the file, used only to read raw JPEG streams. */
export class RawStreams {
  private doc: Promise<PDFDocument | null> | undefined;
  constructor(private bytes: Uint8Array) {}

  private load() {
    this.doc ??= PDFDocument.load(this.bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    })
      .then((d) => (d.context.trailerInfo.Encrypt ? null : d))
      .catch(() => null);
    return this.doc;
  }

  /** Original JPEG bytes for an image object ref like "12R" (EXIF lives there), else null. */
  async jpeg(ref: string): Promise<Uint8Array | null> {
    const m = /^(\d+)R(\d*)$/.exec(ref);
    if (!m) return null;
    const doc = await this.load();
    if (!doc) return null;
    try {
      const obj = doc.context.lookup(PDFRef.of(Number(m[1]), Number(m[2] || 0)));
      if (!(obj instanceof PDFRawStream)) return null;
      const f = obj.dict.get(PDFName.of('Filter'));
      const only =
        f instanceof PDFName ? f : f instanceof PDFArray && f.size() === 1 ? f.get(0) : null;
      return only instanceof PDFName && only.asString() === '/DCTDecode' ? obj.contents : null;
    } catch {
      return null;
    }
  }
}

/** pdf.js resolves some images (e.g. with soft masks) after the operator list; wait briefly. */
export const IMAGE_WAIT_MS = 5000;

function getObj(page: PDFPageProxy, id: string): Promise<unknown> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
    try {
      store.get(id, (obj: unknown) => {
        clearTimeout(timer);
        resolve(obj);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export async function detectPdfImages(
  page: PDFPageProxy,
  model: PageModel,
  raw: RawStreams,
  seen: Set<string>,
  sink: FindingSink,
  warnings: string[],
): Promise<void> {
  for (const p of model.paints) {
    if (p.kind !== 'image') continue;
    if (seen.size >= MAX_PDF_IMAGES) {
      if (!seen.has('__warned')) {
        warnings.push(`Only the first ${MAX_PDF_IMAGES} images were checked.`);
        seen.add('__warned');
      }
      return;
    }
    const obj = p.imageId ? await getObj(page, p.imageId) : p.inlineImage;
    const ref =
      (obj as { ref?: string } | null)?.ref ?? p.imageId ?? `inline-${model.pageNumber}-${p.order}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const pixels = pixelsFromPdfjs(obj);
    const jpeg =
      p.imageId && (obj as { ref?: string } | null)?.ref
        ? await raw.jpeg((obj as { ref: string }).ref)
        : null;
    if (!pixels && !jpeg) continue;
    const b = p.bbox;
    const mapRegion = pixels
      ? (r: { x: number; y: number; width: number; height: number }): BBox => {
          const sx = (b[2] - b[0]) / pixels.width;
          const sy = (b[3] - b[1]) / pixels.height;
          return [
            b[0] + r.x * sx,
            b[3] - (r.y + r.height) * sy,
            b[0] + (r.x + r.width) * sx,
            b[3] - r.y * sy,
          ];
        }
      : undefined;
    await analyzeImage(jpeg ?? new Uint8Array(), sink, warnings, {
      source: `image on page ${model.pageNumber}`,
      page: model.pageNumber,
      bbox: b,
      pixels,
      ...(mapRegion ? { mapRegion } : {}),
    });
  }
}
