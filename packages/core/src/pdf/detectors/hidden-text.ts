import type { RGB } from '../../util.js';
import { FindingSink, contrast, coverage } from '../../util.js';
import type { PageModel, Paint, TextRun } from '../interpret.js';
import { joinRuns, unionBox } from './text-join.js';

export type HiddenReason =
  'invisible' | 'transparent' | 'tiny' | 'off-page' | 'low-contrast' | 'under-image';

const WHITE: RGB = [255, 255, 255];

/** Below this WCAG contrast ratio text is effectively unreadable against its background. */
export const MIN_CONTRAST = 1.25;
/** Rendered glyph height (points) below which text cannot be read. */
export const MIN_HEIGHT = 1;

const TEXT: Record<HiddenReason, { title: (r: TextRun) => string; fix: string }> = {
  invisible: {
    title: () =>
      "Text is set to invisible. It doesn't show on the page, but it's still in the file and anyone can copy or search it.",
    fix: 'Delete the text in the source document, or run `redactguard clean` to rasterize this page.',
  },
  transparent: {
    title: () =>
      'Text is fully transparent. It is invisible, but still in the file and can be copied.',
    fix: 'Delete the text in the source document, or run `redactguard clean` to rasterize this page.',
  },
  tiny: {
    title: (r) =>
      `Text is too small to see (${r.height.toFixed(2)} pt high), but it is still in the file and can be copied.`,
    fix: 'Delete the text in the source document, or run `redactguard clean` to rasterize this page.',
  },
  'off-page': {
    title: () =>
      'Text sits outside the visible page (for example, cropped away). Cropping hides it but does not delete it.',
    fix: 'Delete the text in the source document, or run `redactguard clean` to rasterize this page.',
  },
  'low-contrast': {
    title: () =>
      'Text is the same colour as its background (like white on white). You cannot see it, but anyone can select, copy or search it.',
    fix: 'Delete the text instead of recolouring it, or run `redactguard clean` to rasterize this page.',
  },
  'under-image': {
    title: () => 'Text is hidden under an image. Moving the image or copying the page reveals it.',
    fix: 'Delete the text underneath, or run `redactguard clean` to rasterize this page.',
  },
};

export interface HiddenTextResult {
  /** Pages with an invisible text layer over a scanned image (normal OCR). */
  ocrLayer: boolean;
}

export function classifyRun(t: TextRun, model: PageModel): HiddenReason | 'ocr' | null {
  if (!/[\p{L}\p{N}]/u.test(t.text)) return null;
  const view = model.view;
  // Text rendered as invisible or clip-only.
  if (t.renderMode === 3 || t.renderMode === 7) {
    const underImage = model.paints.some(
      (p) =>
        p.order < t.order &&
        p.kind === 'image' &&
        p.annotation === null &&
        coverage(t.bbox, p.bbox) >= 0.5,
    );
    return underImage ? 'ocr' : 'invisible';
  }
  if (t.alpha <= 0.05) return 'transparent';
  if (t.height < MIN_HEIGHT) return 'tiny';
  if (coverage(t.bbox, view) < 0.1) return 'off-page';

  // Painted after the text and covering it: an image on top hides it.
  const coveringImage = model.paints.find(
    (p) =>
      p.order > t.order &&
      p.kind === 'image' &&
      p.annotation === null &&
      p.alpha >= 0.9 &&
      coverage(t.bbox, p.bbox) >= 0.5,
  );
  if (coveringImage) return 'under-image';

  if (
    t.color &&
    (t.renderMode === 0 || t.renderMode === 2 || t.renderMode === 4 || t.renderMode === 6)
  ) {
    const bg = backgroundOf(t, model.paints);
    if (bg !== 'unknown' && contrast(t.color, bg) < MIN_CONTRAST) return 'low-contrast';
  }
  return null;
}

/** Colour directly behind a text run: the last opaque fill under it, or white paper. */
function backgroundOf(t: TextRun, paints: Paint[]): RGB | 'unknown' {
  for (let i = paints.length - 1; i >= 0; i--) {
    const p = paints[i]!;
    if (p.order > t.order || p.annotation !== null) continue;
    if (p.alpha < 0.5) continue;
    if (coverage(t.bbox, p.bbox) < 0.5) continue;
    if (p.kind === 'image' || p.kind === 'shading') return 'unknown';
    if (p.kind === 'fill') return p.color ?? 'unknown';
  }
  return WHITE;
}

export function detectHiddenText(model: PageModel, sink: FindingSink): HiddenTextResult {
  const runs = model.texts.filter((t) => t.annotation === null);
  let ocrLayer = false;
  let group: TextRun[] = [];
  let groupReason: HiddenReason | null = null;

  const flush = () => {
    if (groupReason && group.length) {
      const text = joinRuns(group);
      if (text) {
        const t = TEXT[groupReason];
        const bbox = unionBox(group);
        sink.add({
          rule: `pdf.hidden-text.${groupReason}`,
          detector: 'hidden-text',
          severity: 'high',
          title: t.title(group[0]!),
          page: model.pageNumber,
          ...(bbox ? { bbox } : {}),
          evidence: text,
          fix: t.fix,
          details: {
            reason: groupReason,
            color: group[0]!.color ? `rgb(${group[0]!.color.join(',')})` : undefined,
            renderMode: group[0]!.renderMode,
          },
        });
      }
    }
    group = [];
    groupReason = null;
  };

  for (const t of runs) {
    const reason = classifyRun(t, model);
    if (reason === 'ocr') {
      ocrLayer = true;
      flush();
      continue;
    }
    if (reason === null) {
      // Whitespace-only runs do not break a hidden group.
      if (!/[\p{L}\p{N}]/u.test(t.text) && groupReason) {
        group.push(t);
        continue;
      }
      flush();
      continue;
    }
    if (reason !== groupReason) flush();
    groupReason = reason;
    group.push(t);
  }
  flush();
  return { ocrLayer };
}
