import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api.js';
import type { BBox } from '../../types.js';
import { FindingSink, coverage, intersect, area, truncate, union } from '../../util.js';
import type { PageModel } from '../interpret.js';
import { joinRuns } from './text-join.js';

export interface AnnotData {
  id?: string;
  subtype?: string;
  annotationType?: number;
  rect?: number[];
  quadPoints?: ArrayLike<number> | null;
  contentsObj?: { str?: string };
  titleObj?: { str?: string };
  richText?: { str?: string } | null;
  overlaytext?: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: unknown;
  hidden?: boolean;
  noView?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  modificationDate?: string | null;
  popupRef?: string | null;
  parentType?: string | null;
}

const MARKUP = new Set([
  'Text',
  'FreeText',
  'Highlight',
  'Underline',
  'Squiggly',
  'StrikeOut',
  'Square',
  'Circle',
  'Line',
  'Polygon',
  'PolyLine',
  'Ink',
  'Stamp',
  'Caret',
  'FileAttachment',
  'Sound',
]);

function normRect(r: number[] | undefined): BBox | null {
  if (!r || r.length < 4) return null;
  const [a, b, c, d] = r as [number, number, number, number];
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** Quad points → list of boxes (each quad is 8 numbers). */
function quadBoxes(q: ArrayLike<number> | null | undefined): BBox[] {
  const out: BBox[] = [];
  if (!q) return out;
  for (let i = 0; i + 7 < q.length; i += 8) {
    const xs = [q[i]!, q[i + 2]!, q[i + 4]!, q[i + 6]!];
    const ys = [q[i + 1]!, q[i + 3]!, q[i + 5]!, q[i + 7]!];
    out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return out;
}

export async function loadAnnotations(page: PDFPageProxy): Promise<AnnotData[]> {
  try {
    return (await page.getAnnotations({ intent: 'display' })) as AnnotData[];
  } catch {
    return [];
  }
}

export function detectAnnotations(annots: AnnotData[], model: PageModel, sink: FindingSink): void {
  const pageNo = model.pageNumber;
  for (const a of annots) {
    const subtype = a.subtype ?? '';
    const rect = normRect(a.rect);
    const contents = (a.contentsObj?.str ?? a.richText?.str ?? '').trim();
    const author = (a.titleObj?.str ?? '').trim();

    if (subtype === 'Redact') {
      const boxes = quadBoxes(a.quadPoints);
      if (boxes.length === 0 && rect) boxes.push(rect);
      const under = model.texts.filter(
        (t) => t.annotation === null && boxes.some((b) => coverage(t.bbox, b) >= 0.5),
      );
      const text = joinRuns(under);
      const bbox =
        boxes.reduce<BBox | null>((acc, b) => (acc ? union(acc, b) : b), null) ?? undefined;
      sink.add({
        rule: 'pdf.annotation.unapplied-redaction',
        detector: 'annotations',
        severity: text ? 'high' : 'medium',
        title: text
          ? 'A redaction was marked but never applied. The text under the mark is still in the file and can be copied.'
          : 'A redaction was marked but never applied. Whatever is under the mark is still in the file.',
        page: pageNo,
        ...(bbox ? { bbox } : {}),
        evidence: text || '(no text under the mark; it may cover an image)',
        fix: 'Apply the redaction in your PDF editor (e.g. Acrobat: Redact → Apply), or run `redactguard clean`, which burns it in.',
        details: { author: author || undefined, overlayText: a.overlaytext || undefined },
      });
      continue;
    }

    if (subtype === 'Widget') {
      const value = fieldValueString(a);
      if (!value) continue;
      const hidden =
        !!a.hidden || !!a.noView || !rect || area(rect) < 1 || coverage(rect, model.view) < 0.1;
      sink.add({
        rule: hidden ? 'pdf.form.hidden-field' : 'pdf.form.filled-field',
        detector: 'annotations',
        severity: hidden ? 'high' : 'low',
        title: hidden
          ? 'A hidden form field holds a value. It does not show on the page but is stored in the file.'
          : 'A form field is filled in and still editable. Anyone can read or change the value.',
        page: pageNo,
        ...(rect ? { bbox: rect } : {}),
        evidence: `${a.fieldName ?? '(unnamed field)'} = ${value}`,
        fix: hidden
          ? 'Clear the field, or run `redactguard clean` to flatten forms.'
          : 'If the form is final, flatten it (Print to PDF) or run `redactguard clean`.',
        details: { fieldName: a.fieldName, fieldType: a.fieldType },
      });
      continue;
    }

    if (subtype === 'Popup' || subtype === 'Link' || subtype === 'Widget') continue;
    if (!MARKUP.has(subtype) && !contents) continue;
    if (!contents && !author) continue;

    // Text that a highlight / strike-out marks is part of the leak too (e.g. "delete this").
    let marked = '';
    if (['Highlight', 'Underline', 'Squiggly', 'StrikeOut'].includes(subtype)) {
      const boxes = quadBoxes(a.quadPoints);
      marked = joinRuns(
        model.texts.filter(
          (t) => t.annotation === null && boxes.some((b) => area(intersect(t.bbox, b)) > 0),
        ),
      );
    }
    const parts = [
      author ? `Author: ${author}` : '',
      contents ? `Comment: ${contents}` : '',
      marked ? `Marked text: ${truncate(marked, 200)}` : '',
    ].filter(Boolean);
    sink.add({
      rule: 'pdf.annotation.comment',
      detector: 'annotations',
      severity: contents ? 'medium' : 'low',
      title: contents
        ? `A ${label(subtype)} contains a comment${author ? ` by "${author}"` : ''}. Comments travel with the file and show up in the comments panel.`
        : `A ${label(subtype)} records its author's name ("${author}").`,
      page: pageNo,
      ...(rect ? { bbox: rect } : {}),
      evidence: parts.join('\n'),
      fix: 'Delete comments and markups before sharing, or run `redactguard clean`, which removes all annotations.',
      details: { subtype, author: author || undefined, hidden: a.hidden || undefined },
    });
  }
}

function label(subtype: string): string {
  const m: Record<string, string> = {
    Text: 'sticky note',
    FreeText: 'text box annotation',
    Highlight: 'highlight',
    Underline: 'underline mark',
    Squiggly: 'squiggly underline',
    StrikeOut: 'strike-out mark',
    FileAttachment: 'file attachment',
    Ink: 'drawing',
  };
  return m[subtype] ?? `${subtype.toLowerCase()} annotation`;
}

function fieldValueString(a: AnnotData): string {
  const v = a.fieldValue;
  if (v === null || v === undefined) return '';
  if (a.pushButton) return '';
  if (a.checkBox || a.radioButton) {
    const s = String(v);
    return s && s !== 'Off' ? `[checked: ${s}]` : '';
  }
  if (Array.isArray(v)) return v.map(String).join(', ').trim();
  return String(v).trim();
}
