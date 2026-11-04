import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../fixtures/generate.js';
import { ScanError, scanBytes, scanFile } from '../src/index.js';

const scan = () => scanFile(path.join(FIXTURE_DIR, 'tracked-changes.docx'));
const find = async (rule: string) => (await scan()).findings.filter((f) => f.rule === rule);

describe('DOCX detectors', () => {
  it('clean DOCX has no findings (white on dark shading is visible)', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'clean.docx'));
    expect(r.kind).toBe('docx');
    expect(r.findings).toEqual([]);
  });

  it('tracked deletions are high and show the deleted text and author', async () => {
    const del = await find('docx.tracked-deletion');
    expect(del.map((f) => f.evidence)).toEqual([
      '12,000',
      'Clause 9 removed: penalty waived for Fictional Corp (FAKE)',
    ]);
    expect(del.every((f) => f.severity === 'high')).toBe(true);
    expect(del[0]!.title).toContain('"Jordan Example"');
  });

  it('tracked insertions and formatting changes', async () => {
    expect((await find('docx.tracked-insertion')).map((f) => [f.evidence, f.severity])).toEqual([
      ['15,000', 'medium'],
    ]);
    const fmt = await find('docx.tracked-formatting');
    expect(fmt[0]!.title).toContain('Riley Sample');
  });

  it('comments include author, text and what they are attached to', async () => {
    const [c] = await find('docx.comment');
    expect(c!.evidence).toBe(
      'Author: Riley Sample\nComment: Can we hide the late fee from them? (FAKE)\nOn text: Payment within 30 days.',
    );
  });

  it('hidden text: vanish, hidden style, white, tiny; text boxes read once', async () => {
    const r = await scan();
    const hidden = r.findings.filter((f) => f.rule.startsWith('docx.hidden-text.'));
    expect(hidden.map((f) => [f.rule, f.evidence]).sort()).toEqual([
      ['docx.hidden-text.tiny', 'Tiny: ref 000-FAKE'],
      ['docx.hidden-text.vanish', 'Hidden: internal margin is 40% (FAKE)'],
      ['docx.hidden-text.vanish', 'Style-hidden: board vote 3-2 (FAKE)'],
      ['docx.hidden-text.vanish', 'Textbox note'],
      ['docx.hidden-text.white', 'White: competitor bid was 11,500 (FAKE)'],
    ]);
  });

  it('properties, paths (template, linked file, field code), variables, custom XML, embeddings', async () => {
    const r = await scan();
    const ev = (rule: string) => r.findings.filter((f) => f.rule === rule).map((f) => f.evidence);
    expect(ev('docx.metadata.author')).toEqual([
      'core/dc:creator: Jordan Example\ncore/cp:lastModifiedBy: Riley Sample',
    ]);
    expect(ev('docx.metadata.company')[0]).toContain('app/Company: Acme Fictional Ltd');
    expect(ev('docx.file-path').sort()).toEqual([
      'C:\\Users\\jexample\\Pictures\\signature.png',
      'file:///C:\\Users\\jexample\\AppData\\Roaming\\Microsoft\\Templates\\Contracts.dotm',
      'file:///\\\\fileserver\\hr\\salaries-2026.xlsx',
    ]);
    expect(r.findings.find((f) => f.evidence.includes('signature.png'))!.title).toContain(
      '"jexample"',
    );
    expect(ev('docx.document-variables')).toEqual(['DealCode = PROJECT-OWL (FAKE)']);
    expect(ev('docx.custom-xml')).toEqual(['customXml/item1.xml: Jordan Example · FIC-0042']);
    expect(ev('docx.embedded-object')[0]).toContain('Microsoft_Excel_Worksheet.xlsx');
    // Web hyperlinks are normal and not reported.
    expect(JSON.stringify(r.findings)).not.toContain('example.com/terms');
  });

  it('runs image checks on embedded images and names the part', async () => {
    const [gps] = await find('image.gps');
    expect(gps!.severity).toBe('high');
    expect(gps!.title).toContain('word/media/image1.jpeg');
    expect(gps!.details).toMatchObject({ source: 'word/media/image1.jpeg' });
  });

  it('broken or fake DOCX files fail with a clear error', async () => {
    const z = new JSZip();
    z.file('word/document.xml.bak', 'x');
    z.file('readme.txt', 'word/document.xml');
    const noMain = await z.generateAsync({ type: 'uint8array' });
    await expect(scanBytes(noMain, 'x.docx')).rejects.toBeInstanceOf(ScanError);
    const bad = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04,
      ...new TextEncoder().encode('word/document.xml garbage'),
    ]);
    await expect(scanBytes(bad, 'bad.docx')).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('malformed XML inside a part does not crash the scan', async () => {
    const z = await JSZip.loadAsync(
      await (
        await import('node:fs/promises')
      ).readFile(path.join(FIXTURE_DIR, 'tracked-changes.docx')),
    );
    z.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>unclosed');
    z.file('docProps/core.xml', '<<<not xml');
    const r = await scanBytes(await z.generateAsync({ type: 'uint8array' }), 'broken.docx');
    expect(r.kind).toBe('docx');
  });
});
