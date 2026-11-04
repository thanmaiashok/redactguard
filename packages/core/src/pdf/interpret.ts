/**
 * Walks a pdf.js operator list and records, in paint order:
 *  - every run of shown text with its box, fill colour, alpha and render mode
 *  - every painted shape / image with its box and colour
 * Detectors use this to find text that is drawn but cannot be seen.
 */
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api.js';
import type { BBox } from '../types.js';
import { IDENTITY, type Matrix, type RGB, hexToRgb, mul, transformBox, union } from '../util.js';
import type { LoadedPdf } from './load.js';

export interface TextRun {
  order: number;
  text: string;
  bbox: BBox;
  /** null = pattern / shading / unknown colour. */
  color: RGB | null;
  alpha: number;
  renderMode: number;
  /** Rendered glyph height in points. */
  height: number;
  /** Annotation id when the text belongs to an annotation appearance. */
  annotation: string | null;
  /** Per-glyph text and box, for partial-coverage checks. */
  glyphs: { text: string; bbox: BBox }[];
}

export type PaintKind = 'fill' | 'stroke' | 'image' | 'image-mask' | 'shading';

export interface Paint {
  order: number;
  kind: PaintKind;
  bbox: BBox;
  color: RGB | null;
  alpha: number;
  /** For fills: path is an axis-aligned rectangle. */
  isRect: boolean;
  /** Line width in page points (CTM applied). */
  lineWidth: number;
  /** For strokes: the path is a single straight line (a "bar"). */
  isLine: boolean;
  /** Normal (source-over) blending; multiply etc. leave text visible. */
  blendNormal: boolean;
  /** A soft mask is active, so opacity is unknown. */
  softMask: boolean;
  annotation: string | null;
}

export interface PageModel {
  pageNumber: number;
  /** Page box [x0,y0,x1,y1] in points. */
  view: BBox;
  texts: TextRun[];
  paints: Paint[];
}

interface Glyph {
  unicode?: string;
  width?: number;
  isSpace?: boolean;
  vmetric?: number[];
}

interface GState {
  ctm: Matrix;
  fill: RGB | null;
  stroke: RGB | null;
  fillAlpha: number;
  strokeAlpha: number;
  lineWidth: number;
  blendNormal: boolean;
  softMask: boolean;
  // text state (part of the graphics state in PDF)
  font: string | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  renderMode: number;
}

const BLACK: RGB = [0, 0, 0];

function initialState(): GState {
  return {
    ctm: IDENTITY,
    fill: BLACK,
    stroke: BLACK,
    fillAlpha: 1,
    strokeAlpha: 1,
    lineWidth: 1,
    blendNormal: true,
    softMask: false,
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
  };
}

function asMatrix(v: unknown): Matrix | null {
  if (v && typeof v === 'object' && 'length' in v && (v as ArrayLike<number>).length === 6) {
    const a = Array.from(v as ArrayLike<number>);
    if (a.every((n) => Number.isFinite(n))) return a as Matrix;
  }
  return null;
}

export async function buildPageModel(pdf: LoadedPdf, page: PDFPageProxy): Promise<PageModel> {
  const { OPS } = pdf.pdfjs;
  const opList = await page.getOperatorList({
    annotationMode: pdf.pdfjs.AnnotationMode.ENABLE_FORMS,
  });
  const fontMatrices = new Map<string, number>();
  const fontScale = (id: string | null): number => {
    if (!id) return 0.001;
    let v = fontMatrices.get(id);
    if (v === undefined) {
      v = 0.001;
      try {
        const f = page.commonObjs.has(id)
          ? (page.commonObjs.get(id) as { fontMatrix?: number[] })
          : null;
        const fm = f?.fontMatrix;
        if (fm && Number.isFinite(fm[0]) && fm[0]) v = fm[0];
      } catch {
        /* keep default */
      }
      fontMatrices.set(id, v);
    }
    return v;
  };

  const texts: TextRun[] = [];
  const paints: Paint[] = [];
  const stack: GState[] = [];
  let gs = initialState();
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let order = 0;
  let annotation: string | null = null;
  const annotationStack: (string | null)[] = [];

  const showGlyphs = (items: unknown[]) => {
    const size = gs.fontSize;
    const scale = fontScale(gs.font);
    let text = '';
    let box: BBox | null = null;
    const glyphs: { text: string; bbox: BBox }[] = [];
    for (const item of items) {
      if (typeof item === 'number') {
        // TJ spacing, thousandths of text space.
        const tx = (-item / 1000) * size * gs.hScale;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
        continue;
      }
      const g = item as Glyph | null;
      if (!g) continue;
      const w0 = (g.width ?? 0) * scale;
      const adv = (w0 * size + gs.charSpacing + (g.isSpace ? gs.wordSpacing : 0)) * gs.hScale;
      const trm = mul([size * gs.hScale, 0, 0, size, 0, gs.rise], mul(tm, gs.ctm));
      // Glyph box in glyph space: width w0, descent -0.2 .. ascent 0.8.
      const gb = transformBox(trm, [0, -0.2, w0, 0.8]);
      box = box ? union(box, gb) : gb;
      text += g.unicode ?? '';
      glyphs.push({ text: g.unicode ?? '', bbox: gb });
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    }
    if (!box || text.length === 0) return;
    const trm = mul([size * gs.hScale, 0, 0, size, 0, gs.rise], mul(tm, gs.ctm));
    const height = Math.hypot(trm[2], trm[3]);
    texts.push({
      order: order++,
      text,
      bbox: box,
      color: gs.fill,
      alpha: gs.fillAlpha,
      renderMode: gs.renderMode,
      height,
      annotation,
      glyphs,
    });
  };

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
    tm = tlm;
  };

  const addPaint = (kind: PaintKind, local: BBox, extra: Partial<Paint> = {}) => {
    const bbox = transformBox(gs.ctm, local);
    paints.push({
      order: order++,
      kind,
      bbox,
      color: kind === 'stroke' ? gs.stroke : gs.fill,
      alpha: kind === 'stroke' ? gs.strokeAlpha : gs.fillAlpha,
      isRect: false,
      isLine: false,
      lineWidth: gs.lineWidth * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])),
      blendNormal: gs.blendNormal,
      softMask: gs.softMask,
      annotation,
      ...extra,
    });
  };

  const fns = opList.fnArray;
  const argsArr = opList.argsArray as unknown[][];
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    const args = (argsArr[i] ?? []) as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...gs });
        break;
      case OPS.restore:
        gs = stack.pop() ?? gs;
        break;
      case OPS.transform: {
        const m = asMatrix(args);
        if (m) gs.ctm = mul(m, gs.ctm);
        break;
      }
      case OPS.setLineWidth:
        gs.lineWidth = Number(args[0]) || 0;
        break;
      case OPS.setGState: {
        const entries = (args[0] ?? []) as [string, unknown][];
        for (const e of entries) {
          if (!Array.isArray(e)) continue;
          const [k, v] = e;
          if (k === 'ca' && typeof v === 'number') gs.fillAlpha = v;
          else if (k === 'CA' && typeof v === 'number') gs.strokeAlpha = v;
          else if (k === 'LW' && typeof v === 'number') gs.lineWidth = v;
          else if (k === 'BM') {
            const bm = String(v).toLowerCase();
            gs.blendNormal = bm === 'source-over' || bm === 'normal' || bm === 'compatible';
          } else if (k === 'SMask') gs.softMask = !!v && v !== 'None';
          else if (k === 'Font' && Array.isArray(v)) {
            gs.font = String(v[0]);
            gs.fontSize = Number(v[1]) || 0;
          }
        }
        break;
      }
      case OPS.setFillRGBColor:
        gs.fill = hexToRgb(String(args[0]));
        break;
      case OPS.setStrokeRGBColor:
        gs.stroke = hexToRgb(String(args[0]));
        break;
      case OPS.setFillTransparent:
        gs.fill = null;
        gs.fillAlpha = 0;
        break;
      case OPS.setStrokeTransparent:
        gs.stroke = null;
        gs.strokeAlpha = 0;
        break;
      case OPS.setFillColorN:
      case OPS.setFillColor:
        gs.fill = null; // pattern or unresolved colour
        break;
      case OPS.setStrokeColorN:
      case OPS.setStrokeColor:
        gs.stroke = null;
        break;

      // ---- text ----
      case OPS.beginText:
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case OPS.setFont:
        gs.font = String(args[0]);
        gs.fontSize = Number(args[1]) || 0;
        break;
      case OPS.setCharSpacing:
        gs.charSpacing = Number(args[0]) || 0;
        break;
      case OPS.setWordSpacing:
        gs.wordSpacing = Number(args[0]) || 0;
        break;
      case OPS.setHScale:
        gs.hScale = (Number(args[0]) || 0) / 100;
        break;
      case OPS.setLeading:
        gs.leading = Number(args[0]) || 0;
        break;
      case OPS.setTextRise:
        gs.rise = Number(args[0]) || 0;
        break;
      case OPS.setTextRenderingMode:
        gs.renderMode = Number(args[0]) || 0;
        break;
      case OPS.moveText:
        tlm = mul([1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0], tlm);
        tm = tlm;
        break;
      case OPS.setLeadingMoveText:
        gs.leading = -(Number(args[1]) || 0);
        tlm = mul([1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0], tlm);
        tm = tlm;
        break;
      case OPS.setTextMatrix: {
        const m = asMatrix(args[0]) ?? asMatrix(args);
        if (m) {
          tlm = m;
          tm = m;
        }
        break;
      }
      case OPS.nextLine:
        nextLine();
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        showGlyphs((args[0] as unknown[]) ?? []);
        break;
      case OPS.nextLineShowText:
        nextLine();
        showGlyphs((args[0] as unknown[]) ?? []);
        break;
      case OPS.nextLineSetSpacingShowText:
        gs.wordSpacing = Number(args[0]) || 0;
        gs.charSpacing = Number(args[1]) || 0;
        nextLine();
        showGlyphs((args[2] as unknown[]) ?? []);
        break;

      // ---- paths ----
      case OPS.constructPath: {
        const op = args[0] as number;
        const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
        const mm = args[2] as ArrayLike<number> | null | undefined;
        if (!mm || mm.length < 4) break;
        const local: BBox = [mm[0]!, mm[1]!, mm[2]!, mm[3]!];
        if (![local[0], local[1], local[2], local[3]].every(Number.isFinite)) break;
        const isFill =
          op === OPS.fill ||
          op === OPS.eoFill ||
          op === OPS.fillStroke ||
          op === OPS.eoFillStroke ||
          op === OPS.closeFillStroke ||
          op === OPS.closeEOFillStroke;
        const isStroke = op === OPS.stroke || op === OPS.closeStroke;
        if (isFill) addPaint('fill', local, { isRect: isAxisRect(data, gs.ctm) });
        else if (isStroke) {
          const hw = gs.lineWidth / 2;
          addPaint('stroke', [local[0] - hw, local[1] - hw, local[2] + hw, local[3] + hw], {
            isLine: isStraightLine(data),
          });
        }
        break;
      }
      case OPS.shadingFill:
        // Fills the current clip; we do not track clips, so record it as unknown-coloured.
        break;

      // ---- images ----
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageXObjectRepeat:
        addPaint('image', [0, 0, 1, 1], { color: null, alpha: gs.fillAlpha });
        break;
      case OPS.paintImageMaskXObject:
      case OPS.paintSolidColorImageMask:
        addPaint('image-mask', [0, 0, 1, 1]);
        break;

      // ---- forms / annotations ----
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...gs });
        const m = asMatrix(args[0]);
        if (m) gs.ctm = mul(m, gs.ctm);
        break;
      }
      case OPS.paintFormXObjectEnd:
        gs = stack.pop() ?? gs;
        break;
      case OPS.beginAnnotation: {
        stack.push({ ...gs });
        annotationStack.push(annotation);
        annotation = String(args[0]);
        const t = asMatrix(args[2]);
        const m = asMatrix(args[3]);
        if (t) gs.ctm = mul(t, gs.ctm);
        if (m) gs.ctm = mul(m, gs.ctm);
        break;
      }
      case OPS.endAnnotation:
        gs = stack.pop() ?? gs;
        annotation = annotationStack.pop() ?? null;
        break;
      default:
        break;
    }
  }

  const v = page.view;
  return {
    pageNumber: page.pageNumber,
    view: [
      Math.min(v[0]!, v[2]!),
      Math.min(v[1]!, v[3]!),
      Math.max(v[0]!, v[2]!),
      Math.max(v[1]!, v[3]!),
    ],
    texts,
    paints,
  };
}

/** True when the path is a single axis-aligned rectangle (after the CTM). */
function isAxisRect(data: ArrayLike<number> | undefined, ctm: Matrix): boolean {
  if (!data) return false;
  // Rotation/skew in the CTM makes a rect non-axis-aligned.
  if (Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6) {
    if (Math.abs(ctm[0]) > 1e-6 || Math.abs(ctm[3]) > 1e-6) return false;
  }
  const pts: [number, number][] = [];
  let i = 0;
  let subpaths = 0;
  while (i < data.length) {
    const op = data[i++];
    if (op === 0) {
      if (++subpaths > 1) return false;
      pts.push([data[i]!, data[i + 1]!]);
      i += 2;
    } else if (op === 1) {
      pts.push([data[i]!, data[i + 1]!]);
      i += 2;
    } else if (op === 4) {
      // closePath
    } else {
      return false; // curves
    }
  }
  if (pts.length > 1) {
    const f = pts[0]!;
    const l = pts[pts.length - 1]!;
    if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) pts.pop();
  }
  if (pts.length !== 4) return false;
  for (let k = 0; k < 4; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % 4]!;
    if (Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6) return false;
  }
  return true;
}

/** True when the path is one straight segment (moveTo + lineTo). */
function isStraightLine(data: ArrayLike<number> | undefined): boolean {
  if (!data) return false;
  let lines = 0;
  let i = 0;
  while (i < data.length) {
    const op = data[i];
    if (op === 0)
      i += 3; // repeated moveTo is harmless
    else if (op === 1) {
      lines++;
      i += 3;
    } else return false;
  }
  return lines === 1;
}
