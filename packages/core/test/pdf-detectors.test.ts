import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../fixtures/generate.js';
import { scanFile, type ScanReport } from '../src/index.js';

const scan = (n: string) => scanFile(path.join(FIXTURE_DIR, n));
const rules = (r: ScanReport) => r.findings.map((f) => f.rule).sort();

describe('PDF detectors', () => {
  it('clean PDF has no findings (white-on-black and grey text are visible, not hidden)', async () => {
    const r = await scan('clean.pdf');
    expect(r.findings).toEqual([]);
    expect(r.counts).toEqual({ high: 0, medium: 0, low: 0, info: 0 });
  });

  it('hidden-text: finds every way of hiding text, each as high severity with a box', async () => {
    const r = await scan('hidden-text.pdf');
    expect(rules(r)).toEqual([
      'pdf.hidden-text.invisible',
      'pdf.hidden-text.low-contrast',
      'pdf.hidden-text.off-page',
      'pdf.hidden-text.tiny',
      'pdf.hidden-text.transparent',
      'pdf.hidden-text.under-image',
    ]);
    for (const f of r.findings) {
      expect(f.severity).toBe('high');
      expect(f.page).toBe(1);
      expect(f.bbox).toHaveLength(4);
      expect(f.title.length).toBeGreaterThan(20);
      expect(f.fix).toMatch(/redactguard clean/);
    }
    const white = r.findings.find((f) => f.rule === 'pdf.hidden-text.low-contrast')!;
    expect(white.evidence).toBe('Hidden note: team B budget cut 40% (FAKE)');
    // Box sits where the text was drawn (x=50, y=690, 12pt).
    expect(white.bbox![0]).toBeCloseTo(50, 0);
    expect(white.bbox![1]).toBeGreaterThan(685);
    expect(white.bbox![3]).toBeLessThan(702);
  });

  it('a normal OCR text layer over a scan is info only, not a leak', async () => {
    const r = await scan('ocr-scan.pdf');
    expect(r.findings.map((f) => [f.rule, f.severity])).toEqual([
      ['pdf.hidden-text.ocr-layer', 'info'],
    ]);
  });

  it('metadata: author, company and file paths (with username) are medium', async () => {
    const r = await scan('metadata.pdf');
    const medium = r.findings.filter((f) => f.severity === 'medium');
    expect(medium.map((f) => f.rule).sort()).toEqual([
      'pdf.metadata.author',
      'pdf.metadata.company',
      'pdf.metadata.file-path',
      'pdf.metadata.file-path',
    ]);
    const winPath = medium.find((f) => f.evidence.startsWith('C:\\'))!;
    expect(winPath.title).toContain('"jexample"');
    const author = r.findings.find((f) => f.rule === 'pdf.metadata.author')!;
    // Same value in Info and XMP is reported once.
    expect(author.evidence).toBe('Info/Author, XMP/dc:creator: Jordan Example');
  });

  it('annotations: comments with authors, filled and hidden form fields', async () => {
    const r = await scan('annotations.pdf');
    expect(r.counts).toEqual({ high: 1, medium: 2, low: 1, info: 0 });
    const hidden = r.findings.find((f) => f.rule === 'pdf.form.hidden-field')!;
    expect(hidden.evidence).toBe('internal.notes = Client credit score 512 (FAKE)');
    const note = r.findings.find((f) => f.evidence.includes('9,000'))!;
    expect(note.title).toContain('sticky note');
    expect(note.title).toContain('Jordan Example');
    const hl = r.findings.find((f) => f.evidence.includes('Riley Sample'))!;
    expect(hl.evidence).toContain('Marked text: Fee: 12,000 per month');
  });

  it('unapplied redaction: reports the text still sitting under the mark', async () => {
    const r = await scan('unapplied-redaction.pdf');
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.rule).toBe('pdf.annotation.unapplied-redaction');
    expect(f.severity).toBe('high');
    expect(f.evidence).toBe('Account: 4111 1111 1111 1111 (FAKE)');
  });

  it('scans in well under 3 seconds', async () => {
    const r = await scan('hidden-text.pdf');
    expect(r.durationMs).toBeLessThan(3000);
  });
});
