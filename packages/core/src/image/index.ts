import type { ScanReport } from '../types.js';
import { FindingSink, countSeverities, sortFindings } from '../util.js';
import { analyzeImage } from './analyze.js';

export async function scanImage(bytes: Uint8Array, file: string): Promise<ScanReport> {
  const started = performance.now();
  const sink = new FindingSink();
  const warnings: string[] = [];
  await analyzeImage(bytes, sink, warnings, { warnPixels: true });
  const findings = sortFindings(sink.findings);
  return {
    file,
    kind: 'image',
    findings,
    counts: countSeverities(findings),
    warnings,
    durationMs: Math.round(performance.now() - started),
  };
}
