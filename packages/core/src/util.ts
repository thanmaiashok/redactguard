import type { BBox, Finding, Severity } from './types.js';
import { SEVERITY_ORDER } from './types.js';

export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 × m2 (apply m1 first, then m2), PDF convention. */
export function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function applyPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Axis-aligned box of a rectangle transformed by m. */
export function transformBox(m: Matrix, b: BBox): BBox {
  const pts = [
    applyPoint(m, b[0], b[1]),
    applyPoint(m, b[2], b[1]),
    applyPoint(m, b[0], b[3]),
    applyPoint(m, b[2], b[3]),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function area(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

export function intersect(a: BBox, b: BBox): BBox {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

/** Fraction of `inner` covered by `outer` (0..1). */
export function coverage(inner: BBox, outer: BBox): number {
  const a = area(inner);
  if (a <= 0) return 0;
  return area(intersect(inner, outer)) / a;
}

export function union(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function roundBox(b: BBox): BBox {
  return b.map((v) => Math.round(v * 100) / 100) as BBox;
}

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLum([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1 (identical) .. 21 (black on white). */
export function contrast(a: RGB, b: RGB): number {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function truncate(s: string, n = 80): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

/** Windows, UNC, macOS/Linux home paths and file:// URLs. */
const PATH_RE =
  /(?:[A-Za-z]:\\[^\r\n"<>|]+|\\\\[\w.$-]+\\[^\r\n"<>|]+|file:\/\/\/?[^\s"<>]+|\/(?:Users|home|Volumes|mnt)\/[^\s"<>]+)/;

export function findFilePath(s: string): string | null {
  const m = PATH_RE.exec(s);
  return m ? m[0].trim() : null;
}

export function sortFindings(f: Finding[]): Finding[] {
  return [...f].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.page ?? 0) - (b.page ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export function countSeverities(f: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const x of f) c[x.severity]++;
  return c;
}

/** Builds findings with deterministic ids: `${rule}@p${page}#${n}`. */
export class FindingSink {
  readonly findings: Finding[] = [];
  private counters = new Map<string, number>();

  add(f: Omit<Finding, 'id'>): Finding {
    const key = `${f.rule}@p${f.page ?? 0}`;
    const n = this.counters.get(key) ?? 0;
    this.counters.set(key, n + 1);
    const finding: Finding = { id: `${key}#${n}`, ...f };
    if (finding.bbox) finding.bbox = roundBox(finding.bbox);
    this.findings.push(finding);
    return finding;
  }
}
