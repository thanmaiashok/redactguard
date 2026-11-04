/**
 * Text that sits under an opaque shape painted later: the classic "black box" fake redaction.
 * Works per glyph, so a box over just the account number in a longer line is caught.
 */
import type { BBox } from '../../types.js';
import { FindingSink, type RGB, coverage, union } from '../../util.js';
import type { PageModel, Paint, TextRun } from '../interpret.js';
import { joinRuns } from './text-join.js';

/** Fraction of a glyph that must be under the shape. */
export const MIN_OVERLAP = 0.5;
/** Shapes this opaque or more hide what is under them. */
export const MIN_ALPHA = 0.9;
/** A stroked straight line at least this thick (points) can work as a bar over text. */
export const MIN_BAR_WIDTH = 3;

const HAS_CONTENT = /[\p{L}\p{N}]/u;

export function isOccluder(p: Paint, skipAnnotations: Set<string>): boolean {
  if (p.alpha < MIN_ALPHA || !p.blendNormal || p.softMask || !p.color) return false;
  if (p.annotation !== null && skipAnnotations.has(p.annotation)) return false;
  if (p.kind === 'fill') return true;
  if (p.kind === 'stroke') return p.isLine && p.lineWidth >= MIN_BAR_WIDTH;
  return false;
}

function colourName([r, g, b]: RGB): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 60) return 'black';
  if (min > 220) return 'white';
  if (max - min < 25) return 'grey';
  return 'coloured';
}

interface Group {
  paints: Paint[];
  bbox: BBox;
  /** Covered glyphs per run, in paint order. */
  spans: Map<TextRun, number[]>;
}

export interface CoveredResult {
  /** Runs whose visible content is mostly covered (hidden-text skips these). */
  coveredRuns: Set<TextRun>;
}

export function detectCoveredText(
  model: PageModel,
  sink: FindingSink,
  skipAnnotations: Set<string> = new Set(),
): CoveredResult {
  const occluders = model.paints.filter((p) => isOccluder(p, skipAnnotations));
  const coveredRuns = new Set<TextRun>();
  if (occluders.length === 0) return { coveredRuns };

  // Merge touching shapes of the same colour (tools often draw one box per line or word).
  const groups: Group[] = [];
  for (const p of occluders) {
    const touching = groups.filter((g) => sameColour(g.paints[0]!, p) && near(g.bbox, p.bbox, 2));
    if (touching.length === 0) {
      groups.push({ paints: [p], bbox: p.bbox, spans: new Map() });
      continue;
    }
    const first = touching[0]!;
    first.paints.push(p);
    first.bbox = union(first.bbox, p.bbox);
    for (const g of touching.slice(1)) {
      first.paints.push(...g.paints);
      first.bbox = union(first.bbox, g.bbox);
      groups.splice(groups.indexOf(g), 1);
    }
  }

  for (const run of model.texts) {
    if (run.annotation !== null) continue;
    let content = 0;
    let covered = 0;
    run.glyphs.forEach((gl, idx) => {
      const isContent = HAS_CONTENT.test(gl.text);
      if (isContent) content++;
      for (const g of groups) {
        const hit = g.paints.some(
          (p) => p.order > run.order && coverage(gl.bbox, p.bbox) >= MIN_OVERLAP,
        );
        if (hit) {
          if (isContent) covered++;
          const list = g.spans.get(run) ?? [];
          list.push(idx);
          g.spans.set(run, list);
          break;
        }
      }
    });
    if (content > 0 && covered / content >= 0.5) coveredRuns.add(run);
  }

  for (const g of groups) {
    if (g.spans.size === 0) continue;
    // Turn covered glyph indices into contiguous pseudo-runs, then join them like normal text.
    const pieces: TextRun[] = [];
    for (const [run, idxs] of g.spans) {
      let start = 0;
      for (let k = 1; k <= idxs.length; k++) {
        if (k === idxs.length || idxs[k] !== idxs[k - 1]! + 1) {
          const gl = run.glyphs.slice(idxs[start]!, idxs[k - 1]! + 1);
          const bbox = gl.reduce<BBox>((b, x) => union(b, x.bbox), gl[0]!.bbox);
          pieces.push({ ...run, text: gl.map((x) => x.text).join(''), bbox, glyphs: gl });
          start = k;
        }
      }
    }
    const text = joinRuns(pieces);
    if (!HAS_CONTENT.test(text)) continue;
    const colour = colourName(g.paints[0]!.color!);
    const viaAnnotation = g.paints.some((p) => p.annotation !== null);
    const shape = viaAnnotation
      ? `a ${colour} annotation box`
      : g.paints.every((p) => p.kind === 'stroke')
        ? `a thick ${colour} line`
        : `a ${colour} box`;
    sink.add({
      rule: 'pdf.covered-text',
      detector: 'covered-text',
      severity: 'high',
      title: `Text is hidden under ${shape}. The box only covers it visually. The text is still in the file and anyone can copy it.`,
      page: model.pageNumber,
      bbox: g.bbox,
      evidence: text,
      fix: 'Use a real redaction tool that deletes the text, or run `redactguard clean` to burn the box into the page.',
      details: {
        shape: viaAnnotation ? 'annotation' : g.paints[0]!.kind,
        colour,
        boxes: g.paints.length,
      },
    });
  }
  return { coveredRuns };
}

function sameColour(a: Paint, b: Paint): boolean {
  const ca = a.color!;
  const cb = b.color!;
  return Math.abs(ca[0] - cb[0]) + Math.abs(ca[1] - cb[1]) + Math.abs(ca[2] - cb[2]) < 30;
}

function near(a: BBox, b: BBox, gap: number): boolean {
  return a[0] - gap <= b[2] && b[0] - gap <= a[2] && a[1] - gap <= b[3] && b[1] - gap <= a[3];
}
