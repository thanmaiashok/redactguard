import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../fixtures/generate.js';
import { revisionEnds } from '../src/pdf/detectors/revisions.js';
import { scanFile } from '../src/index.js';

const scan = (n: string) => scanFile(path.join(FIXTURE_DIR, n));

describe('covered text (black boxes)', () => {
  it('recovers text under boxes, whiteout, bars, annotation boxes and boxes on scans', async () => {
    const r = await scan('black-box.pdf');
    const covered = r.findings.filter((f) => f.rule === 'pdf.covered-text');
    expect(covered.map((f) => f.evidence).sort()).toEqual([
      '000-12-3456',
      '99-FAKE',
      'Home address: 1 Fictional Way',
      'Medical note line one: FAKE condition A\nMedical note line two: FAKE medication B',
      'Phone: 555-0199 (FAKE)',
      'Salary: 87,500 (FAKE)',
    ]);
    for (const f of covered) {
      expect(f.severity).toBe('high');
      expect(f.page).toBe(1);
      expect(f.bbox).toHaveLength(4);
    }
  });

  it('only the covered part of a line is reported (per-glyph)', async () => {
    const r = await scan('black-box.pdf');
    const ssn = r.findings.find((f) => f.evidence === '000-12-3456')!;
    expect(ssn.title).toContain('black box');
    expect(r.findings.some((f) => f.evidence.includes('Casey Placeholder'))).toBe(false);
  });

  it('describes the shape in plain words', async () => {
    const r = await scan('black-box.pdf');
    const by = (e: string) => r.findings.find((f) => f.evidence.startsWith(e))!.title;
    expect(by('Salary')).toContain('white box');
    expect(by('Home address')).toContain('thick black line');
    expect(by('Phone')).toContain('annotation box');
  });

  it('multiply-blend highlights and see-through boxes are not reported', async () => {
    const r = await scan('black-box.pdf');
    const all = r.findings.map((f) => f.evidence).join('\n');
    expect(all).not.toContain('Highlighted but visible');
    expect(all).not.toContain('Behind tinted glass');
  });

  it('OCR text under a box is covered text; the rest of the OCR layer is just info', async () => {
    const r = await scan('black-box.pdf');
    expect(r.findings.find((f) => f.rule === 'pdf.hidden-text.ocr-layer')?.severity).toBe('info');
    expect(r.findings.some((f) => f.rule.startsWith('pdf.hidden-text.invisible'))).toBe(false);
  });

  it('unapplied Redact annotations are not double-reported as covered text', async () => {
    const r = await scan('unapplied-redaction.pdf');
    expect(r.findings.map((f) => f.rule)).toEqual(['pdf.annotation.unapplied-redaction']);
  });
});

describe('incremental updates (old versions inside the file)', () => {
  it('finds deleted text, deleted comments and old metadata in the earlier version', async () => {
    const r = await scan('incremental.pdf');
    const get = (rule: string) => r.findings.find((f) => f.rule === rule)!;
    expect(get('pdf.revisions.removed-text').evidence).toBe(
      'Confidential: acquisition of Fictional Corp for 40M (FAKE)',
    );
    expect(get('pdf.revisions.removed-text').severity).toBe('high');
    expect(get('pdf.revisions.removed-text').details).toMatchObject({
      version: 1,
      totalVersions: 2,
      pages: [1],
    });
    expect(get('pdf.revisions.removed-comment').evidence).toBe('Do not share the price (FAKE)');
    expect(get('pdf.revisions.old-metadata').evidence).toContain('Author: Jordan Example');
    // The visible, current page does not contain the removed line.
    expect(r.findings.some((f) => f.rule === 'pdf.revisions.history')).toBe(false);
  });

  it('a history with no removed content is low severity', async () => {
    const r = await scan('incremental-history.pdf');
    const h = r.findings.find((f) => f.rule === 'pdf.revisions.history')!;
    expect(h.severity).toBe('low');
    expect(r.counts.high).toBe(0);
  });

  it('single-revision files report no history', async () => {
    const r = await scan('hidden-text.pdf');
    expect(r.findings.some((f) => f.detector === 'revisions')).toBe(false);
  });

  it('revisionEnds only counts real startxref/%%EOF trailers', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(
      revisionEnds(enc('%PDF-1.7\nstream %%EOF endstream\nstartxref\n10\n%%EOF\n')),
    ).toHaveLength(1);
    expect(revisionEnds(enc('startxref\n1\n%%EOF\nmore\nstartxref 99 %%EOF'))).toEqual([18, 41]);
  });
});
