import type { BBox } from '../../types.js';
import { union } from '../../util.js';
import type { TextRun } from '../interpret.js';

/** Joins runs in paint order, inserting spaces / newlines where there are gaps. */
export function joinRuns(runs: TextRun[]): string {
  let out = '';
  let prev: TextRun | null = null;
  for (const r of runs) {
    if (prev) {
      const h = Math.max(prev.height, r.height, 1);
      const sameLine = Math.abs(prev.bbox[1] - r.bbox[1]) < h * 0.5;
      if (!sameLine) out += '\n';
      else if (r.bbox[0] - prev.bbox[2] > h * 0.15 && !out.endsWith(' ') && !r.text.startsWith(' '))
        out += ' ';
    }
    out += r.text;
    prev = r;
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

export function unionBox(runs: TextRun[]): BBox | undefined {
  let b: BBox | undefined;
  for (const r of runs) b = b ? union(b, r.bbox) : r.bbox;
  return b;
}
