/**
 * Incremental updates: when a PDF is edited and saved "in place", the old version stays in the
 * file and the changes are appended. Cutting the file at an earlier %%EOF restores the old version.
 * We open every earlier version and report text, comments and metadata that the final version lost.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api.js';
import { FindingSink } from '../../util.js';
import { openPdf, type LoadedPdf } from '../load.js';

/** Safety cap so a file with thousands of updates cannot stall a scan. */
export const MAX_REVISIONS = 25;

const HAS_CONTENT = /[\p{L}\p{N}]/u;
const INFO_KEYS = ['Author', 'Title', 'Subject', 'Keywords', 'Creator', 'Producer'];

/** Byte offsets just past each `startxref N %%EOF` marker. */
export function revisionEnds(bytes: Uint8Array): number[] {
  const s = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const re = /startxref\s+\d+\s+%%EOF[ \t]*(?:\r\n|\r|\n)?/g;
  const ends: number[] = [];
  for (let m = re.exec(s); m; m = re.exec(s)) ends.push(m.index + m[0].length);
  return ends;
}

interface Snapshot {
  pages: number;
  lines: { page: number; text: string }[];
  comments: { page: number; text: string }[];
  info: Record<string, string>;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

async function snapshot(doc: PDFDocumentProxy): Promise<Snapshot> {
  const lines: Snapshot['lines'] = [];
  const comments: Snapshot['comments'] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      let cur = '';
      for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) {
        cur += it.str ?? '';
        if (it.hasEOL) {
          if (norm(cur)) lines.push({ page: n, text: norm(cur) });
          cur = '';
        }
      }
      if (norm(cur)) lines.push({ page: n, text: norm(cur) });
      const annots = (await page.getAnnotations()) as { contentsObj?: { str?: string } }[];
      for (const a of annots) {
        const c = norm(a.contentsObj?.str ?? '');
        if (c) comments.push({ page: n, text: c });
      }
      page.cleanup();
    } catch {
      /* a damaged page in an old revision is skipped */
    }
  }
  const info: Record<string, string> = {};
  try {
    const meta = (await doc.getMetadata()).info as Record<string, unknown>;
    for (const k of INFO_KEYS)
      if (typeof meta[k] === 'string' && norm(meta[k])) info[k] = norm(meta[k]);
  } catch {
    /* ignore */
  }
  return { pages: doc.numPages, lines, comments, info };
}

export async function detectRevisions(
  pdf: LoadedPdf,
  sink: FindingSink,
  warnings: string[],
): Promise<void> {
  let ends = revisionEnds(pdf.bytes);
  if (ends.length < 2) return;
  const info = (await pdf.doc.getMetadata().catch(() => ({ info: {} }))).info as {
    IsLinearized?: boolean;
  };
  // A linearized ("fast web view") file has a first-page section that is not a real revision.
  if (info?.IsLinearized) ends = ends.slice(1);
  if (ends.length < 2) return;

  const total = ends.length;
  const earlier = ends.slice(0, -1).slice(-MAX_REVISIONS);
  if (total - 1 > MAX_REVISIONS) {
    warnings.push(`Only the last ${MAX_REVISIONS} of ${total - 1} earlier versions were checked.`);
  }

  const final = await snapshot(pdf.doc);
  const finalText = norm(final.lines.map((l) => l.text).join(' '));
  const finalComments = new Set(final.comments.map((c) => c.text));
  let reported = false;

  for (const [i, end] of earlier.entries()) {
    const version = total - earlier.length + i; // 1-based version number
    let old: Snapshot;
    try {
      const oldPdf = await openPdf(pdf.bytes.subarray(0, end));
      try {
        old = await snapshot(oldPdf.doc);
      } finally {
        await oldPdf.doc.loadingTask.destroy().catch(() => undefined);
      }
    } catch {
      continue; // not a readable revision on its own
    }
    const label = `version ${version} of ${total}`;
    const where = { version, totalVersions: total, endsAtByte: end };

    const removed = old.lines.filter(
      (l) => HAS_CONTENT.test(l.text) && !finalText.includes(l.text),
    );
    if (removed.length) {
      reported = true;
      const pages = [...new Set(removed.map((l) => l.page))];
      sink.add({
        rule: 'pdf.revisions.removed-text',
        detector: 'revisions',
        severity: 'high',
        title: `Text you deleted is still in the file. An earlier saved version (${label}) is kept inside it and anyone can restore it.`,
        evidence: removed.map((l) => l.text).join('\n'),
        fix: 'Save a fresh copy (File → Save As, or Print to PDF) so the history is dropped, or run `redactguard clean`.',
        details: { ...where, pages },
      });
    }

    const goneComments = old.comments.filter((c) => !finalComments.has(c.text));
    if (goneComments.length) {
      reported = true;
      sink.add({
        rule: 'pdf.revisions.removed-comment',
        detector: 'revisions',
        severity: 'medium',
        title: `Comments you deleted are still in an earlier saved version (${label}) inside the file.`,
        evidence: goneComments.map((c) => c.text).join('\n'),
        fix: 'Save a fresh copy without history, or run `redactguard clean`.',
        details: { ...where, pages: [...new Set(goneComments.map((c) => c.page))] },
      });
    }

    const changedMeta = Object.entries(old.info).filter(([k, v]) => final.info[k] !== v);
    if (changedMeta.length) {
      reported = true;
      sink.add({
        rule: 'pdf.revisions.old-metadata',
        detector: 'revisions',
        severity: 'medium',
        title: `Old document properties are still in an earlier saved version (${label}) inside the file.`,
        evidence: changedMeta.map(([k, v]) => `${k}: ${v}`).join('\n'),
        fix: 'Save a fresh copy without history, or run `redactguard clean`.',
        details: { ...where, fields: Object.fromEntries(changedMeta) },
      });
    }
  }

  if (!reported) {
    sink.add({
      rule: 'pdf.revisions.history',
      detector: 'revisions',
      severity: 'low',
      title: `The file keeps ${total - 1} earlier saved version${total > 2 ? 's' : ''} inside it. No removed text was found, but the history is there.`,
      evidence: `${total} versions; earlier ones end at bytes ${earlier.join(', ')}`,
      fix: 'Save a fresh copy (Save As / Print to PDF) or run `redactguard clean` to drop the history.',
      details: { totalVersions: total, endsAtByte: earlier },
    });
  }
}
