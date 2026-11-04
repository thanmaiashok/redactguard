/**
 * Finds mosaic ("pixelated") areas. Flagging only: redactguard never tries to reverse pixelation.
 *
 * A mosaic is a grid of b x b blocks, each one flat colour. We:
 *  1. find flat horizontal runs in every row, and stack identical runs on consecutive rows
 *     into flat rectangles;
 *  2. for each block size b (largest first), keep rectangles whose width/height are multiples of b
 *     and that sit on one common grid (phase);
 *  3. group those grid cells into connected areas and keep dense, varied ones.
 */
import type { Pixels } from './decode.js';

export interface MosaicRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Block size in pixels. */
  block: number;
}

export const MIN_BLOCK = 4;
export const MAX_BLOCK = 32;
/** Neighbouring pixels within this per-channel difference count as the same colour. */
export const FLAT_TOLERANCE = 10;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  used: boolean;
}

function flatRects(p: Pixels, tol: number): Rect[] {
  const { width: W, height: H, data: d } = p;
  const rects: Rect[] = [];
  // Active stacks keyed by x0*65536 + x1.
  let active = new Map<number, { x0: number; x1: number; y0: number }>();
  const close = (s: { x0: number; x1: number; y0: number }, yEnd: number) => {
    const w = s.x1 - s.x0;
    const h = yEnd - s.y0;
    if (w >= MIN_BLOCK && h >= MIN_BLOCK) rects.push({ x: s.x0, y: s.y0, w, h, used: false });
  };
  for (let y = 0; y < H; y++) {
    const next = new Map<number, { x0: number; x1: number; y0: number }>();
    let x0 = 0;
    const row = y * W * 4;
    for (let x = 1; x <= W; x++) {
      let edge = x === W;
      if (!edge) {
        const i = row + x * 4;
        const j = i - 4;
        edge =
          Math.abs(d[i]! - d[j]!) > tol ||
          Math.abs(d[i + 1]! - d[j + 1]!) > tol ||
          Math.abs(d[i + 2]! - d[j + 2]!) > tol;
      }
      if (edge) {
        const key = x0 * 65536 + x;
        const prev = active.get(key);
        if (prev) {
          active.delete(key);
          next.set(key, prev);
        } else {
          next.set(key, { x0, x1: x, y0: y });
        }
        x0 = x;
      }
    }
    for (const s of active.values()) close(s, y);
    active = next;
  }
  for (const s of active.values()) close(s, H);
  return rects;
}

const fitsMultiple = (v: number, b: number, tol: number) => {
  const m = v % b;
  return v >= b && (m <= tol || b - m <= tol);
};

export function detectMosaic(p: Pixels): MosaicRegion[] {
  if (p.width < MIN_BLOCK * 3 || p.height < MIN_BLOCK * 2) return [];
  const rects = flatRects(p, FLAT_TOLERANCE);
  const regions: MosaicRegion[] = [];

  for (let b = MAX_BLOCK; b >= MIN_BLOCK; b--) {
    const tol = b >= 8 ? 1 : 0;
    const fit = rects.filter(
      (r) =>
        !r.used &&
        r.w <= 16 * b &&
        r.h <= 16 * b &&
        fitsMultiple(r.w, b, tol) &&
        fitsMultiple(r.h, b, tol),
    );
    if (fit.length < 8) continue;
    // Dominant grid phase.
    const hx = new Array<number>(b).fill(0);
    const hy = new Array<number>(b).fill(0);
    for (const r of fit) {
      hx[r.x % b]!++;
      hy[r.y % b]!++;
    }
    const px = hx.indexOf(Math.max(...hx));
    const py = hy.indexOf(Math.max(...hy));
    const near = (v: number, ph: number) => {
      const m = (((v - ph) % b) + b) % b;
      return m <= tol || b - m <= tol;
    };
    const aligned = fit.filter((r) => near(r.x, px) && near(r.y, py));
    if (aligned.length < 8) continue;

    // Mark covered grid cells.
    const cells = new Map<string, Rect>();
    for (const r of aligned) {
      const cx0 = Math.round((r.x - px) / b);
      const cy0 = Math.round((r.y - py) / b);
      const cw = Math.round(r.w / b);
      const ch = Math.round(r.h / b);
      for (let cy = cy0; cy < cy0 + ch; cy++)
        for (let cx = cx0; cx < cx0 + cw; cx++) cells.set(`${cx},${cy}`, r);
    }
    // Connected components (4-neighbour).
    const seen = new Set<string>();
    for (const start of cells.keys()) {
      if (seen.has(start)) continue;
      const queue = [start];
      seen.add(start);
      const comp: [number, number][] = [];
      const compRects = new Set<Rect>();
      while (queue.length) {
        const k = queue.pop()!;
        const [cx, cy] = k.split(',').map(Number) as [number, number];
        comp.push([cx, cy]);
        compRects.add(cells.get(k)!);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nk = `${cx + dx},${cy + dy}`;
          if (cells.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            queue.push(nk);
          }
        }
      }
      const xs = comp.map((c) => c[0]);
      const ys = comp.map((c) => c[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const density = comp.length / (bw * bh);
      const singleBlocks = [...compRects].filter(
        (r) => Math.round(r.w / b) === 1 || Math.round(r.h / b) === 1,
      ).length;
      if (
        bw < 3 ||
        bh < 2 ||
        comp.length < 8 ||
        density < 0.6 ||
        compRects.size < 6 ||
        singleBlocks < 4
      )
        continue;
      for (const r of compRects) r.used = true;
      const x = Math.max(0, px + minX * b);
      const y = Math.max(0, py + minY * b);
      regions.push({
        x,
        y,
        width: Math.min(p.width, px + (maxX + 1) * b) - x,
        height: Math.min(p.height, py + (maxY + 1) * b) - y,
        block: b,
      });
    }
  }
  return mergeRegions(regions).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** JPEG noise can split one mosaic into pieces: join same-size neighbours on the same band. */
function mergeRegions(list: MosaicRegion[]): MosaicRegion[] {
  const out = [...list];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const c = out[j]!;
        if (a.block !== c.block) continue;
        const gap = 2 * a.block;
        const overlapY = Math.min(a.y + a.height, c.y + c.height) - Math.max(a.y, c.y);
        const overlapX = Math.min(a.x + a.width, c.x + c.width) - Math.max(a.x, c.x);
        if (overlapY > -gap && overlapX > -gap) {
          const x = Math.min(a.x, c.x);
          const y = Math.min(a.y, c.y);
          out[i] = {
            x,
            y,
            width: Math.max(a.x + a.width, c.x + c.width) - x,
            height: Math.max(a.y + a.height, c.y + c.height) - y,
            block: a.block,
          };
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  return out;
}

export type PixelationRisk = 'high' | 'medium' | 'low';

/**
 * Rough risk from block size vs. likely text height. Small blocks over text keep enough detail
 * that published research has recovered such text; blocks bigger than the letters do not.
 */
export function pixelationRisk(r: MosaicRegion): {
  risk: PixelationRisk;
  textHeight: number | null;
} {
  const rows = r.height / r.block;
  if (rows <= 6) {
    // Looks like a strip over a line of text: letters fill roughly 70% of the strip.
    const textHeight = Math.round(r.height * 0.7);
    const ratio = r.block / textHeight;
    return { risk: ratio < 0.5 ? 'high' : ratio < 1 ? 'medium' : 'low', textHeight };
  }
  return { risk: r.block <= 8 ? 'medium' : 'low', textHeight: null };
}
