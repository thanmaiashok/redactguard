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
  PDFDocument,
  PDFHexString,
  PDFName,
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

function pngBlock(w: number, h: number, label: string, bg = '#d9d9d9'): Buffer {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#222222';
  ctx.font = `${Math.round(h * 0.45)}px sans-serif`;
  ctx.fillText(label, 8, h * 0.65);
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

export const FIXTURES: Record<string, () => Promise<Uint8Array>> = {
  'clean.pdf': cleanPdf,
  'metadata.pdf': metadataPdf,
  'hidden-text.pdf': hiddenTextPdf,
  'ocr-scan.pdf': ocrScanPdf,
  'annotations.pdf': annotationsPdf,
  'unapplied-redaction.pdf': unappliedRedactionPdf,
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
