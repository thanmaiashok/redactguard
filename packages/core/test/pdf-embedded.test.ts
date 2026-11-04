import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../fixtures/generate.js';
import { scanFile } from '../src/index.js';

describe('PDF: embedded files, JavaScript and images', () => {
  it('reports attachments, document JavaScript, and runs image checks on page images', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'embedded.pdf'));
    const by = (rule: string) => r.findings.filter((f) => f.rule === rule);
    expect(by('pdf.embedded-file').map((f) => f.evidence)).toEqual([
      'salaries-FAKE.csv (1 KB) — Salary export (FAKE)',
    ]);
    expect(by('pdf.javascript')[0]!.evidence).toBe('[document] app.alert("Opened (FAKE)");');

    const gps = by('image.gps')[0]!;
    expect(gps.page).toBe(1);
    expect(gps.title).toContain('image on page 1');
    // EXIF comes from the original JPEG bytes stored in the PDF.
    expect(gps.evidence).toContain('51.50070, -0.12460');

    const pix = by('image.pixelation')[0]!;
    expect(pix.severity).toBe('high');
    // Region mapped to page points: image drawn at x=50..530, y=200..400 (480x200 px → 1pt/px); mosaic at px x=120..336.
    expect(pix.bbox![0]).toBeCloseTo(170, 0);
    expect(pix.bbox![2]).toBeCloseTo(386, 0);
    expect(pix.bbox![3]).toBeCloseTo(400 - 72, 0);
    expect(r.warnings).toEqual([]);
  });

  it('PDFs without images or scripts report none of these', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'clean.pdf'));
    expect(r.findings).toEqual([]);
  });
});
