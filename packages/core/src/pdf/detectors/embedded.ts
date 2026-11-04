/** Attached files and JavaScript inside a PDF. */
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api.js';
import { analyzeImage, sniffImage } from '../../image/analyze.js';
import { FindingSink, truncate } from '../../util.js';
import type { AnnotData } from './annotations.js';

interface Attachment {
  filename?: string;
  rawFilename?: string;
  content?: Uint8Array;
  description?: string;
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function asEntries<T>(v: unknown): [string, T][] {
  if (!v) return [];
  if (v instanceof Map) return [...v.entries()] as [string, T][];
  if (typeof v === 'object') return Object.entries(v as Record<string, T>);
  return [];
}

export async function reportAttachment(
  a: Attachment,
  sink: FindingSink,
  warnings: string[],
  where: { page?: number; viaAnnotation?: boolean },
): Promise<void> {
  const name = a.filename || a.rawFilename || '(unnamed file)';
  const size = a.content?.length ?? 0;
  sink.add({
    rule: 'pdf.embedded-file',
    detector: 'embedded',
    severity: 'medium',
    title: `A file is attached inside this PDF ("${name}"). Anyone can open it from the attachments panel.`,
    ...(where.page ? { page: where.page } : {}),
    evidence: `${name} (${kb(size)})${a.description ? ` — ${a.description}` : ''}`,
    fix: 'Remove attachments before sharing (Acrobat: Attachments panel → Delete), or run `redactguard clean`.',
    details: { filename: name, bytes: size, viaAnnotation: where.viaAnnotation || undefined },
  });
  if (a.content && sniffImage(a.content)) {
    await analyzeImage(a.content, sink, warnings, {
      source: `attachment "${name}"`,
      ...(where.page ? { page: where.page } : {}),
    });
  }
}

export async function detectAttachments(
  doc: PDFDocumentProxy,
  sink: FindingSink,
  warnings: string[],
) {
  let list: [string, Attachment][];
  try {
    list = asEntries<Attachment>(await doc.getAttachments());
  } catch {
    return;
  }
  for (const [, a] of list) await reportAttachment(a, sink, warnings, {});
}

/** File attachment annotations (paperclip icons on a page). */
export async function detectAnnotationAttachments(
  annots: AnnotData[],
  pageNumber: number,
  sink: FindingSink,
  warnings: string[],
) {
  for (const a of annots) {
    const file = (a as { file?: Attachment }).file;
    if (a.subtype === 'FileAttachment' && file) {
      await reportAttachment(file, sink, warnings, { page: pageNumber, viaAnnotation: true });
    }
  }
}

function scripts(v: unknown): string[] {
  const out: string[] = [];
  for (const [, list] of asEntries<unknown>(v)) {
    for (const s of Array.isArray(list) ? list : [list])
      if (typeof s === 'string' && s.trim()) out.push(s.trim());
  }
  return out;
}

export async function detectJavaScript(
  doc: PDFDocumentProxy,
  pageScripts: { page: number; code: string }[],
  sink: FindingSink,
) {
  let docLevel: string[] = [];
  try {
    docLevel = scripts(await doc.getJSActions());
  } catch {
    /* ignore */
  }
  const all = [
    ...docLevel.map((code) => ({ where: 'document', code })),
    ...pageScripts.map((s) => ({ where: `page ${s.page}`, code: s.code })),
  ];
  if (!all.length) return;
  sink.add({
    rule: 'pdf.javascript',
    detector: 'embedded',
    severity: 'medium',
    title:
      'This PDF contains JavaScript. Scripts can run when the file is opened and may contact a server or report who opened it.',
    evidence: all.map((s) => `[${s.where}] ${truncate(s.code, 300)}`).join('\n'),
    fix: 'Remove the scripts (Acrobat: Tools → JavaScript) or run `redactguard clean`, which drops all JavaScript.',
    details: { count: all.length },
  });
}

/** Page-level and annotation/field scripts. */
export async function pageScripts(
  page: { getJSActions(): Promise<unknown>; pageNumber: number },
  annots: AnnotData[],
): Promise<{ page: number; code: string }[]> {
  const out: { page: number; code: string }[] = [];
  try {
    for (const code of scripts(await page.getJSActions()))
      out.push({ page: page.pageNumber, code });
  } catch {
    /* ignore */
  }
  for (const a of annots) {
    for (const code of scripts((a as { actions?: unknown }).actions))
      out.push({ page: page.pageNumber, code });
  }
  return out;
}
