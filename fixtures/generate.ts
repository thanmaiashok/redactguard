/**
 * Builds synthetic "leaky" test documents. Every name and number here is fake.
 * Run: pnpm fixtures   (writes to fixtures/out/)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  AnnotationFlags,
  BlendMode,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setGraphicsState,
  setTextRenderingMode,
  TextRenderingMode,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

import { cleanDocx, trackedChangesDocx } from './docx.js';
import { cleanPng, drawFakeText, gpsJpeg, pixelatedPng } from './images.js';

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

const FIXED_DATE = new Date('2026-01-15T09:30:00Z');

/** A fresh document with no metadata at all (pdf-lib adds Producer/dates unless told not to). */
async function newDoc(): Promise<{ doc: PDFDocument; page: PDFPage; font: PDFFont }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return { doc, page, font };
}

function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: false });
}

/** A flat block with letter-like shapes (no fonts, so it renders identically on every OS). */
function pngBlock(w: number, h: number, label: string, bg = '#d9d9d9'): Buffer {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  drawFakeText(
    ctx,
    8,
    Math.round(h * 0.25),
    Math.min(w - 16, label.length * 9),
    Math.round(h * 0.5),
    label.length,
  );
  return c.toBuffer('image/png');
}

// ---------------------------------------------------------------- fixtures

async function cleanPdf() {
  const { doc, page, font } = await newDoc();
  page.drawText('A plain document with nothing hidden.', { x: 50, y: 740, size: 14, font });
  page.drawText('Light grey text is still visible.', {
    x: 50,
    y: 710,
    size: 12,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });
  page.drawRectangle({ x: 45, y: 660, width: 300, height: 26, color: rgb(0, 0, 0) });
  page.drawText('White text on a black banner is visible.', {
    x: 50,
    y: 668,
    size: 12,
    font,
    color: rgb(1, 1, 1),
  });
  return save(doc);
}

async function metadataPdf() {
  const { doc, page, font } = await newDoc();
  page.drawText('Offer letter (synthetic test document)', { x: 50, y: 740, size: 14, font });
  doc.setTitle('DRAFT v3 - offer for Casey Placeholder - do not send');
  doc.setAuthor('Jordan Example');
  doc.setSubject('Compensation');
  doc.setKeywords(['internal', 'hr']);
  doc.setCreator('Microsoft Word for Microsoft 365');
  doc.setProducer('Fictional PDF Library 9.1');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const info = doc['getInfoDict']();
  info.set(PDFName.of('Company'), PDFString.of('Acme Fictional Ltd'));
  info.set(
    PDFName.of('SourceFile'),
    PDFHexString.fromText('C:\\Users\\jexample\\Documents\\HR\\Offer - Casey.docx'),
  );
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <dc:creator><rdf:Seq><rdf:li>Jordan Example</rdf:li></rdf:Seq></dc:creator>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">DRAFT v3 - offer for Casey Placeholder - do not send</rdf:li></rdf:Alt></dc:title>
   <xmp:CreatorTool>Microsoft Word for Microsoft 365</xmp:CreatorTool>
   <xmp:CreateDate>2026-01-15T09:30:00Z</xmp:CreateDate>
   <xmpMM:DocumentID>uuid:00000000-1111-2222-3333-444444444444</xmpMM:DocumentID>
   <pdf:Producer>Fictional PDF Library 9.1</pdf:Producer>
   <pdf:Keywords>/Users/jexample/Shared/hr-private</pdf:Keywords>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const stream = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  return save(doc);
}

async function hiddenTextPdf() {
  const { doc, page, font } = await newDoc();
  page.drawText('Quarterly update (synthetic test document)', { x: 50, y: 740, size: 14, font });
  page.drawText('This paragraph is visible.', { x: 50, y: 710, size: 12, font });
  // 1. White on white.
  page.drawText('Hidden note: team B budget cut 40% (FAKE)', {
    x: 50,
    y: 690,
    size: 12,
    font,
    color: rgb(1, 1, 1),
  });
  // 2. Invisible render mode (Tr 3).
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText('Invisible: password hunter2-FAKE', { x: 50, y: 660, size: 12, font });
  page.pushOperators(popGraphicsState());
  // 3. Too small to see.
  page.drawText('Tiny: account 0000-1234-FAKE', { x: 50, y: 640, size: 0.4, font });
  // 4. Off the page (e.g. cropped away).
  page.drawText('Off-page: salary 99,999 FAKE', { x: 700, y: 620, size: 12, font });
  // 5. Fully transparent via ExtGState.
  const gsRef = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: 0, CA: 0 }));
  page.node.setExtGState(PDFName.of('GSZero'), gsRef);
  page.pushOperators(pushGraphicsState(), setGraphicsState('GSZero'));
  page.drawText('Transparent: client Bob Fictional', { x: 50, y: 590, size: 12, font });
  page.pushOperators(popGraphicsState());
  // 6. Text drawn first, then covered by an image.
  page.drawText('Under image: phone 555-0100 FAKE', { x: 50, y: 550, size: 12, font });
  const img = await doc.embedPng(pngBlock(300, 30, 'logo placeholder'));
  page.drawImage(img, { x: 45, y: 540, width: 300, height: 30 });
  // Negative controls: these are visible and must NOT be flagged.
  page.drawRectangle({ x: 45, y: 490, width: 300, height: 26, color: rgb(0, 0, 0) });
  page.drawText('White on black is visible.', {
    x: 50,
    y: 498,
    size: 12,
    font,
    color: rgb(1, 1, 1),
  });
  page.drawText('Mid grey is visible.', {
    x: 50,
    y: 470,
    size: 12,
    font,
    color: rgb(0.55, 0.55, 0.55),
  });
  return save(doc);
}

async function ocrScanPdf() {
  const { doc, page, font } = await newDoc();
  const img = await doc.embedPng(pngBlock(600, 60, 'SCANNED LETTER 2026', '#ffffff'));
  page.drawImage(img, { x: 6, y: 700, width: 600, height: 60 });
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText('SCANNED LETTER 2026', { x: 14, y: 716, size: 27, font });
  page.pushOperators(popGraphicsState());
  return save(doc);
}

async function annotationsPdf() {
  const { doc, page, font } = await newDoc();
  page.drawText('Contract draft (synthetic test document)', { x: 50, y: 740, size: 14, font });
  page.drawText('Fee: 12,000 per month, payable quarterly.', { x: 50, y: 700, size: 12, font });
  const ctx = doc.context;
  const annots = [
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [400, 690, 420, 710],
      Contents: PDFHexString.fromText('Internal: we can go down to 9,000 if they push (FAKE)'),
      T: PDFHexString.fromText('Jordan Example'),
      Name: 'Comment',
    }),
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [48, 696, 300, 714],
      QuadPoints: [48, 714, 300, 714, 48, 696, 300, 696],
      C: [1, 1, 0],
      Contents: PDFHexString.fromText('Check with legal first'),
      T: PDFHexString.fromText('Riley Sample'),
    }),
  ];
  for (const a of annots) page.node.addAnnot(ctx.register(a));

  const form = doc.getForm();
  const visible = form.createTextField('client.name');
  visible.setText('Morgan Fakename');
  visible.addToPage(page, { x: 50, y: 600, width: 200, height: 20, font });
  const hidden = form.createTextField('internal.notes');
  hidden.setText('Client credit score 512 (FAKE)');
  hidden.addToPage(page, { x: 50, y: 560, width: 200, height: 20, font });
  for (const w of hidden.acroField.getWidgets()) w.setFlagTo(AnnotationFlags.Hidden, true);
  return save(doc);
}

async function unappliedRedactionPdf() {
  const { doc, page, font } = await newDoc();
  page.drawText('Bank details (synthetic test document)', { x: 50, y: 740, size: 14, font });
  page.drawText('Account: 4111 1111 1111 1111 (FAKE)', { x: 50, y: 700, size: 12, font });
  const w = font.widthOfTextAtSize('Account: 4111 1111 1111 1111 (FAKE)', 12);
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Redact',
    Rect: [48, 696, 52 + w, 712],
    QuadPoints: [48, 712, 52 + w, 712, 48, 696, 52 + w, 696],
    IC: [0, 0, 0],
    OverlayText: PDFString.of('REDACTED'),
    T: PDFHexString.fromText('Jordan Example'),
  });
  page.node.addAnnot(doc.context.register(annot));
  return save(doc);
}

async function blackBoxPdf() {
  const { doc, page, font } = await newDoc();
  const at = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 12, font });
  page.drawText('Employee record (synthetic test document)', { x: 50, y: 740, size: 14, font });

  // 1. Black box over just part of a line.
  const prefix = 'Name: Casey Placeholder   SSN: ';
  const ssn = '000-12-3456';
  at(`${prefix}${ssn}   Dept: Testing`, 50, 700);
  const x0 = 50 + font.widthOfTextAtSize(prefix, 12);
  page.drawRectangle({
    x: x0 - 2,
    y: 696,
    width: font.widthOfTextAtSize(ssn, 12) + 4,
    height: 16,
    color: rgb(0, 0, 0),
  });

  // 2. "Whiteout": a white box over a whole line.
  at('Salary: 87,500 (FAKE)', 50, 670);
  page.drawRectangle({ x: 45, y: 665, width: 200, height: 20, color: rgb(1, 1, 1) });

  // 3. A thick black line used as a bar.
  at('Home address: 1 Fictional Way', 50, 640);
  page.drawLine({
    start: { x: 48, y: 644 },
    end: { x: 250, y: 644 },
    thickness: 14,
    color: rgb(0, 0, 0),
  });

  // 4. A filled Square annotation (comment tool) over text.
  at('Phone: 555-0199 (FAKE)', 50, 610);
  const sq = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [48, 605, 190, 623],
    IC: [0, 0, 0],
    C: [0, 0, 0],
  });
  page.node.addAnnot(doc.context.register(sq));

  // 5. One box over two lines.
  at('Medical note line one: FAKE condition A', 50, 580);
  at('Medical note line two: FAKE medication B', 50, 566);
  page.drawRectangle({ x: 45, y: 561, width: 300, height: 33, color: rgb(0, 0, 0) });

  // 6. A scan with an OCR layer, then a black box drawn on the scan.
  const scan = await doc.embedPng(pngBlock(400, 40, 'SCAN: Patient ID 99-FAKE', '#ffffff'));
  page.drawImage(scan, { x: 45, y: 500, width: 400, height: 40 });
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText('SCAN: Patient ID', { x: 53, y: 512, size: 18, font });
  page.drawText('99-FAKE', { x: 260, y: 512, size: 18, font });
  page.pushOperators(popGraphicsState());
  page.drawRectangle({ x: 255, y: 505, width: 90, height: 28, color: rgb(0, 0, 0) });

  // Negative controls: still visible, must NOT be flagged.
  at('Highlighted but visible', 50, 450);
  page.drawRectangle({
    x: 45,
    y: 445,
    width: 160,
    height: 18,
    color: rgb(1, 1, 0),
    blendMode: BlendMode.Multiply,
  });
  at('Behind tinted glass', 50, 420);
  page.drawRectangle({ x: 45, y: 415, width: 160, height: 18, color: rgb(0, 0, 0), opacity: 0.3 });
  return save(doc);
}

/**
 * Appends a hand-written incremental update (what "Save" does in Acrobat):
 * new versions of objects + a new xref section pointing back with /Prev.
 */
function appendUpdate(
  base: Uint8Array,
  objects: { num: number; body: string }[],
  trailer: { size: number; root: string; info?: string },
): Uint8Array {
  const baseStr = Buffer.from(base).toString('latin1');
  const prev = [...baseStr.matchAll(/startxref\s+(\d+)/g)].pop()?.[1];
  if (!prev) throw new Error('base PDF has no startxref');
  let out = baseStr.endsWith('\n') ? baseStr : baseStr + '\n';
  const offsets: [number, number][] = [];
  for (const o of objects) {
    offsets.push([o.num, Buffer.byteLength(out, 'latin1')]);
    out += `${o.num} 0 obj\n${o.body}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 1\n0000000000 65535 f \n';
  for (const [num, off] of offsets.sort((a, b) => a[0] - b[0])) {
    out += `${num} 1\n${String(off).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${trailer.size} /Root ${trailer.root}${trailer.info ? ` /Info ${trailer.info}` : ''} /Prev ${prev} >>\n`;
  out += `startxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

const pdfStr = (s: string) => `(${s.replace(/[\\()]/g, (c) => '\\' + c)})`;

async function incrementalPdf() {
  const { doc, page, font } = await newDoc();
  doc.setTitle('Board minutes - CONFIDENTIAL draft');
  doc.setAuthor('Jordan Example');
  page.drawText('Board minutes (synthetic test document)', { x: 50, y: 740, size: 14, font });
  page.drawText('Confidential: acquisition of Fictional Corp for 40M (FAKE)', {
    x: 50,
    y: 700,
    size: 12,
    font,
  });
  page.drawText('Next meeting: Monday', { x: 50, y: 680, size: 12, font });
  const note = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [400, 690, 420, 710],
    Contents: PDFHexString.fromText('Do not share the price (FAKE)'),
    T: PDFHexString.fromText('Jordan Example'),
  });
  page.node.addAnnot(doc.context.register(note));
  const base = await save(doc);

  // Version 2: the confidential line and the comment are "deleted", author changed.
  const fontDict = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  const fontKey = fontDict.keys()[0]!.toString(); // e.g. "/F1-0123"
  const line = (t: string, size: number, y: number) =>
    `BT ${fontKey} ${size} Tf 50 ${y} Td ${font.encodeText(t).toString()} Tj ET`;
  const content = [
    line('Board minutes (synthetic test document)', 14, 740),
    line('Next meeting: Monday', 12, 680),
  ].join('\n');
  const next = doc.context.largestObjectNumber + 1;
  const pageDict = page.node.clone();
  pageDict.delete(PDFName.of('Annots'));
  pageDict.set(PDFName.of('Contents'), PDFRef.of(next));
  const pageBody = pageDict.toString();
  return appendUpdate(
    base,
    [
      { num: next, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
      { num: page.ref.objectNumber, body: pageBody },
      {
        num: next + 1,
        body: `<< /Title ${pdfStr('Board minutes')} /Author ${pdfStr('Press Office')} >>`,
      },
    ],
    { size: next + 2, root: doc.context.trailerInfo.Root!.toString(), info: `${next + 1} 0 R` },
  );
}

/** An incremental update that changes nothing visible: only the history is there. */
async function incrementalHistoryPdf() {
  const { doc, page, font } = await newDoc();
  page.drawText('Signed form (synthetic test document)', { x: 50, y: 740, size: 14, font });
  const base = await save(doc);
  const next = doc.context.largestObjectNumber + 1;
  return appendUpdate(
    base,
    [{ num: next, body: `<< /Producer ${pdfStr('Fictional Signer 1.0')} >>` }],
    {
      size: next + 1,
      root: doc.context.trailerInfo.Root!.toString(),
      info: `${next} 0 R`,
    },
  );
}

/** Images, an attachment and JavaScript inside a PDF. */
async function embeddedPdf() {
  const { doc, page, font } = await newDoc();
  page.drawText('Site report (synthetic test document)', { x: 50, y: 740, size: 14, font });
  const jpg = await doc.embedJpg(gpsJpeg());
  page.drawImage(jpg, { x: 50, y: 480, width: 240, height: 180 });
  const png = await doc.embedPng(pixelatedPng());
  page.drawImage(png, { x: 50, y: 200, width: 480, height: 200 });
  await doc.attach(
    new TextEncoder().encode('name,salary\nCasey Placeholder,87500\n'),
    'salaries-FAKE.csv',
    {
      mimeType: 'text/csv',
      description: 'Salary export (FAKE)',
      creationDate: FIXED_DATE,
      modificationDate: FIXED_DATE,
    },
  );
  doc.addJavaScript('track', 'app.alert("Opened (FAKE)");');
  return save(doc);
}

export const FIXTURES: Record<string, () => Promise<Uint8Array>> = {
  'clean.pdf': cleanPdf,
  'metadata.pdf': metadataPdf,
  'hidden-text.pdf': hiddenTextPdf,
  'ocr-scan.pdf': ocrScanPdf,
  'annotations.pdf': annotationsPdf,
  'unapplied-redaction.pdf': unappliedRedactionPdf,
  'black-box.pdf': blackBoxPdf,
  'incremental.pdf': incrementalPdf,
  'incremental-history.pdf': incrementalHistoryPdf,
  'embedded.pdf': embeddedPdf,
  'tracked-changes.docx': trackedChangesDocx,
  'clean.docx': cleanDocx,
  'gps.jpg': async () => gpsJpeg(),
  'pixelated.png': async () => pixelatedPng(),
  'clean.png': async () => cleanPng(),
};

export async function generateFixtures(outDir = FIXTURE_DIR): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const [name, make] of Object.entries(FIXTURES)) {
    const file = path.join(outDir, name);
    await writeFile(file, await make());
    written.push(file);
  }
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = await generateFixtures();
  console.log(`Wrote ${files.length} fixtures to ${FIXTURE_DIR}`);
}
