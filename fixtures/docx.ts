/** Synthetic DOCX files, written as raw WordprocessingML. All names and numbers are fake. */
import JSZip from 'jszip';
import { gpsJpeg } from './images.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (s: string) => `<w:t xml:space="preserve">${esc(s)}</w:t>`;
const run = (s: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${t(s)}</w:r>`;
const p = (...inner: string[]) => `<w:p>${inner.join('')}</w:p>`;
const AUTHOR = 'w:author="Jordan Example" w:date="2026-01-10T10:00:00Z"';

/** Fixed timestamp so the zip bytes are deterministic. */
const ZIP_DATE = new Date('2026-01-15T09:30:00Z');

function contentTypes(extra: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
${extra}
</Types>`;
}

const ROOT_RELS = (extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
${extra}
</Relationships>`;

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}<w:sectPr/></w:body></w:document>`;

async function zipUp(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files))
    z.file(name, data, { date: ZIP_DATE, createFolders: false });
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function cleanDocx(): Promise<Uint8Array> {
  return zipUp({
    '[Content_Types].xml': contentTypes(''),
    '_rels/.rels': ROOT_RELS(),
    'word/document.xml': doc(
      p(run('A plain letter with nothing hidden.')) +
        // White text on a dark shaded paragraph is visible: must not be flagged.
        `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="1F3864"/></w:pPr>${run('White on dark shading is visible.', '<w:color w:val="FFFFFF"/>')}</w:p>`,
    ),
  });
}

export async function trackedChangesDocx(): Promise<Uint8Array> {
  const body = [
    p(run('Contract for services (synthetic test document)')),
    // Tracked deletion + insertion in one sentence.
    p(
      run('The fee is '),
      `<w:del w:id="1" ${AUTHOR}><w:r><w:delText xml:space="preserve">12,000</w:delText></w:r></w:del>`,
      `<w:ins w:id="2" ${AUTHOR}>${run('15,000')}</w:ins>`,
      run(' per month.'),
    ),
    // Comment anchored on a sentence.
    p(
      '<w:commentRangeStart w:id="0"/>',
      run('Payment within 30 days.'),
      '<w:commentRangeEnd w:id="0"/>',
      '<w:r><w:commentReference w:id="0"/></w:r>',
    ),
    // Hidden text three ways.
    p(run('Visible text. '), run('Hidden: internal margin is 40% (FAKE)', '<w:vanish/>')),
    p(run('White: competitor bid was 11,500 (FAKE)', '<w:color w:val="FFFFFF"/>')),
    p(run('Tiny: ref 000-FAKE', '<w:sz w:val="2"/>')),
    p(run('Style-hidden: board vote 3-2 (FAKE)', '<w:rStyle w:val="SecretNote"/>')),
    // A whole deleted paragraph.
    `<w:p><w:del w:id="3" ${AUTHOR}><w:r><w:delText>Clause 9 removed: penalty waived for Fictional Corp (FAKE)</w:delText></w:r></w:del></w:p>`,
    // Tracked formatting change.
    p(
      `<w:r><w:rPr><w:b/><w:rPrChange w:id="4" w:author="Riley Sample" w:date="2026-01-11T08:00:00Z"><w:rPr/></w:rPrChange></w:rPr>${t('Bold term')}</w:r>`,
    ),
    // Field code with a local path.
    p(
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
      '<w:r><w:instrText xml:space="preserve"> INCLUDEPICTURE "C:\\\\Users\\\\jexample\\\\Pictures\\\\signature.png" \\* MERGEFORMAT </w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ),
    // Text box content duplicated in Choice/Fallback must be read once.
    p(
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${p(run('Textbox note', '<w:vanish/>'))}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${p(run('Textbox note', '<w:vanish/>'))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>`,
    ),
  ].join('');

  return zipUp({
    '[Content_Types].xml': contentTypes(`
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`),
    '_rels/.rels': ROOT_RELS(`
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>`),
    'word/document.xml': doc(body),
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="embeddings/Microsoft_Excel_Worksheet.xlsx"/>
<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/terms" TargetMode="External"/>
<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="file:///\\\\fileserver\\hr\\salaries-2026.xlsx" TargetMode="External"/>
</Relationships>`,
    'word/comments.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Riley Sample" w:initials="RS" w:date="2026-01-12T14:00:00Z">${p(run('Can we hide the late fee from them? (FAKE)'))}</w:comment></w:comments>`,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="SecretNote"><w:name w:val="Secret Note"/><w:rPr><w:vanish/></w:rPr></w:style></w:styles>`,
    'word/settings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}" xmlns:r="${R}"><w:attachedTemplate r:id="rId1"/><w:docVars><w:docVar w:name="DealCode" w:val="PROJECT-OWL (FAKE)"/></w:docVars></w:settings>`,
    'word/_rels/settings.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:\\Users\\jexample\\AppData\\Roaming\\Microsoft\\Templates\\Contracts.dotm" TargetMode="External"/></Relationships>`,
    'word/media/image1.jpeg': gpsJpeg(),
    'word/embeddings/Microsoft_Excel_Worksheet.xlsx': new Uint8Array(2048).fill(7),
    'customXml/item1.xml':
      '<?xml version="1.0"?><p:properties xmlns:p="urn:fake"><Owner>Jordan Example</Owner><Matter>FIC-0042</Matter></p:properties>',
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Contract DRAFT - internal only</dc:title><dc:creator>Jordan Example</dc:creator><cp:lastModifiedBy>Riley Sample</cp:lastModifiedBy><cp:revision>14</cp:revision>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-05T09:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-12T14:05:00Z</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>Contracts.dotm</Template><TotalTime>312</TotalTime><Application>Microsoft Office Word</Application><Company>Acme Fictional Ltd</Company><Manager>Casey Placeholder</Manager><AppVersion>16.0000</AppVersion></Properties>`,
    'docProps/custom.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ClientCode"><vt:lpwstr>FIC-0042</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Department"><vt:lpwstr>Legal</vt:lpwstr></property></Properties>`,
  });
}
