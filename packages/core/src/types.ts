/** How bad a finding is. */
export type Severity = 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Rectangle in PDF user-space points: [x0, y0, x1, y1] with x0<=x1, y0<=y1. */
export type BBox = [number, number, number, number];

export type FileKind = 'pdf' | 'docx' | 'image' | 'unknown';

export interface Finding {
  /** Unique within a report, stable across runs, e.g. `pdf.hidden-text.low-contrast@p1#0`. */
  id: string;
  /** Rule identifier, e.g. `pdf.hidden-text.low-contrast`. Used by `explain`. */
  rule: string;
  /** Which detector produced it. */
  detector: string;
  severity: Severity;
  /** One plain-language sentence a non-expert understands. */
  title: string;
  /** 1-based page number, when the finding is on a page. */
  page?: number;
  /** Location on the page in PDF points (origin bottom-left). */
  bbox?: BBox;
  /** The leaked content itself (full). Summaries truncate it. */
  evidence: string;
  /** What to do about it. */
  fix: string;
  /** Extra machine-readable data. */
  details?: Record<string, unknown>;
}

export interface ScanReport {
  file: string;
  kind: FileKind;
  pageCount?: number;
  findings: Finding[];
  counts: Record<Severity, number>;
  /** Non-fatal problems hit while scanning (e.g. one page failed to parse). */
  warnings: string[];
  durationMs: number;
}

export class ScanError extends Error {
  constructor(
    message: string,
    readonly code: 'UNSUPPORTED' | 'MALFORMED' | 'ENCRYPTED' | 'IO' | 'INTERNAL',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ScanError';
  }
}
