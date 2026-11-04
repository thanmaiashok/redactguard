import JSZip from 'jszip';
import path from 'node:path/posix';
import { analyzeImage, sniffImage } from '../image/analyze.js';
import { type ScanReport, type Severity, ScanError } from '../types.js';
import {
  FindingSink,
  countSeverities,
  findFilePath,
  sortFindings,
  truncate,
  usernameFromPath,
} from '../util.js';
import { type BodyContext, scanBody } from './body.js';
import { type XNode, child, descendants, isOn, parseXml, textOf } from './xml.js';

/** Zip-bomb guards. */
export const MAX_ENTRIES = 10_000;
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const MAX_IMAGES = 200;

interface Zip {
  zip: JSZip;
  names: string[];
  text(name: string): Promise<string | null>;
  bytes(name: string): Promise<Uint8Array | null>;
  size(name: string): number;
}

async function openZip(bytes: Uint8Array, warnings: string[]): Promise<Zip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch (err) {
    throw new ScanError(
      `Could not read DOCX (not a valid zip): ${(err as Error).message}`,
      'MALFORMED',
      {
        cause: err,
      },
    );
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const size = (n: string) =>
    (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })?._data
      ?.uncompressedSize ?? 0;
  if (names.length > MAX_ENTRIES)
    throw new ScanError('DOCX has too many parts to scan safely.', 'MALFORMED');
  const total = names.reduce((s, n) => s + size(n), 0);
  if (total > MAX_TOTAL_BYTES)
    throw new ScanError('DOCX expands to over 1 GB; refusing to scan (zip bomb?).', 'MALFORMED');
  // Case-insensitive lookup: some producers vary the case of part names.
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const real = (n: string) => lower.get(n.replace(/^\//, '').toLowerCase());
  return {
    zip,
    names,
    size: (n) => size(real(n) ?? n),
    async text(n) {
      const r = real(n);
      if (!r) return null;
      try {
        return await zip.file(r)!.async('string');
      } catch {
        warnings.push(`Part ${r} is damaged and was skipped.`);
        return null;
      }
    },
    async bytes(n) {
      const r = real(n);
      if (!r) return null;
      try {
        return await zip.file(r)!.async('uint8array');
      } catch {
        warnings.push(`Part ${r} is damaged and was skipped.`);
        return null;
      }
    },
  };
}

type MetaCat =
  'author' | 'company' | 'title' | 'software' | 'dates' | 'stats' | 'template' | 'custom';

const META: Record<MetaCat, { rule: string; severity: Severity; title: string; fix: string }> = {
  author: {
    rule: 'docx.metadata.author',
    severity: 'medium',
    title: 'The document names its author and the last person who edited it.',
    fix: 'File → Info → Check for Issues → Inspect Document → remove Document Properties, or run `redactguard clean`.',
  },
  company: {
    rule: 'docx.metadata.company',
    severity: 'medium',
    title: 'The document names a company or manager in its hidden properties.',
    fix: 'Remove document properties or run `redactguard clean`.',
  },
  title: {
    rule: 'docx.metadata.title',
    severity: 'low',
    title:
      'The document has a hidden title, subject, keywords or description. These often keep an internal name.',
    fix: 'Check the text below. Clear it in File → Info → Properties, or run `redactguard clean`.',
  },
  software: {
    rule: 'docx.metadata.software',
    severity: 'low',
    title: 'The document records which app and version created it.',
    fix: 'Run `redactguard clean` to strip app properties.',
  },
  dates: {
    rule: 'docx.metadata.dates',
    severity: 'low',
    title: 'The document records when it was created, last changed and last printed.',
    fix: 'Run `redactguard clean` if the timeline is sensitive.',
  },
  stats: {
    rule: 'docx.metadata.edit-stats',
    severity: 'low',
    title: 'The document records how often it was saved and how long it was edited.',
    fix: 'Run `redactguard clean` to strip app properties.',
  },
  template: {
    rule: 'docx.metadata.template',
    severity: 'low',
    title: 'The document records the template it was based on.',
    fix: 'Run `redactguard clean` to strip app properties.',
  },
  custom: {
    rule: 'docx.metadata.custom',
    severity: 'low',
    title: 'The document has custom properties (often added by company systems or labels).',
    fix: 'Review the values below. Run `redactguard clean` to strip them.',
  },
};

const CORE_MAP: Record<string, MetaCat> = {
  'dc:creator': 'author',
  'cp:lastmodifiedby': 'author',
  'dc:title': 'title',
  'dc:subject': 'title',
  'dc:description': 'title',
  'cp:keywords': 'title',
  'cp:category': 'title',
  'cp:contentstatus': 'title',
  'dcterms:created': 'dates',
  'dcterms:modified': 'dates',
  'cp:lastprinted': 'dates',
  'cp:revision': 'stats',
  'cp:version': 'stats',
};

const APP_MAP: Record<string, MetaCat> = {
  company: 'company',
  manager: 'company',
  application: 'software',
  appversion: 'software',
  template: 'template',
  totaltime: 'stats',
  hyperlinkbase: 'custom',
};

const COMPANY_KEYS = /company|organi[sz]ation|manager|department|client|employer|owner|author/i;

export async function scanDocx(bytes: Uint8Array, file: string): Promise<ScanReport> {
  const started = performance.now();
  const warnings: string[] = [];
  const z = await openZip(bytes, warnings);
  const sink = new FindingSink();

  // Main part (normally word/document.xml).
  const rootRels = parseXml((await z.text('_rels/.rels')) ?? '');
  const mainRel = [...descendants(rootRels, 'Relationship')].find((r) =>
    /officeDocument$/.test(r.attrs.Type ?? ''),
  );
  const mainPart = (mainRel?.attrs.Target ?? 'word/document.xml').replace(/^\//, '');
  const wordDir = path.dirname(mainPart);
  const mainXml = await z.text(mainPart);
  if (mainXml === null)
    throw new ScanError('DOCX main document part is missing or damaged.', 'MALFORMED');

  // Styles that hide text, and a dark page background.
  const hiddenStyles = new Set<string>();
  for (const s of descendants(parseXml((await z.text(`${wordDir}/styles.xml`)) ?? ''), 'w:style')) {
    const rPr = child(s, 'w:rPr');
    if (rPr && isOn(child(rPr, 'w:vanish')) && s.attrs['w:styleId'])
      hiddenStyles.add(s.attrs['w:styleId']);
  }
  const mainNodes = parseXml(mainXml);
  const bg = [...descendants(mainNodes, 'w:background')][0]?.attrs['w:color'];
  const darkBackground = !!bg && /^[0-9a-f]{6}$/i.test(bg) && parseInt(bg, 16) < 0x808080;

  // Body-like parts.
  const bodyParts = [
    mainPart,
    ...z.names
      .filter((n) => new RegExp(`^${wordDir}/(header|footer)\\d*\\.xml$`, 'i').test(n))
      .sort(),
    `${wordDir}/footnotes.xml`,
    `${wordDir}/endnotes.xml`,
  ];
  let anchors = new Map<string, string>();
  for (const part of bodyParts) {
    const xml = part === mainPart ? null : await z.text(part);
    const nodes = part === mainPart ? mainNodes : xml ? parseXml(xml) : null;
    if (!nodes) continue;
    const ctx: BodyContext = { part, hiddenStyles, darkBackground };
    const r = scanBody(nodes, ctx, sink);
    if (part === mainPart) anchors = r.anchors;
  }

  await detectComments(z, `${wordDir}/comments.xml`, anchors, sink);
  await detectProperties(z, sink);
  await detectSettings(z, wordDir, sink);
  await detectPackageParts(z, wordDir, sink, warnings);

  const findings = sortFindings(sink.findings);
  return {
    file,
    kind: 'docx',
    findings,
    counts: countSeverities(findings),
    warnings,
    durationMs: Math.round(performance.now() - started),
  };
}

async function detectComments(
  z: Zip,
  part: string,
  anchors: Map<string, string>,
  sink: FindingSink,
) {
  const xml = await z.text(part);
  if (!xml) return;
  for (const c of descendants(parseXml(xml), 'w:comment')) {
    const text = [...descendants(c.children, 'w:p')]
      .map((p) => [...descendants(p.children, 'w:t')].map(textOf).join(''))
      .join('\n')
      .trim();
    const author = c.attrs['w:author'] ?? '';
    const anchor = (anchors.get(c.attrs['w:id'] ?? '') ?? '').trim();
    if (!text && !author) continue;
    sink.add({
      rule: 'docx.comment',
      detector: 'docx-comments',
      severity: text ? 'medium' : 'low',
      title: `A comment${author ? ` by "${author}"` : ''} is still in the document. Comments, including resolved ones, travel with the file.`,
      evidence: [
        author ? `Author: ${author}` : '',
        text ? `Comment: ${text}` : '',
        anchor ? `On text: ${truncate(anchor, 200)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      fix: 'Review → Delete → Delete All Comments in Document, or run `redactguard clean`.',
      details: {
        author: author || undefined,
        date: c.attrs['w:date'] || undefined,
        initials: c.attrs['w:initials'] || undefined,
      },
    });
  }
}

async function detectProperties(z: Zip, sink: FindingSink) {
  const entries: { where: string; value: string; cat: MetaCat }[] = [];
  const leafValues = (
    nodes: XNode[],
    prefix: string,
    map: Record<string, MetaCat>,
    keyFn = (t: string) => t.toLowerCase(),
  ) => {
    const root = nodes.find((n) => n.tag !== '#text');
    for (const n of root?.children ?? []) {
      if (n.tag === '#text') continue;
      const cat = map[keyFn(n.tag)];
      const value = textOf(n).trim();
      if (cat && value) entries.push({ where: `${prefix}/${n.tag}`, value, cat });
    }
  };
  leafValues(parseXml((await z.text('docProps/core.xml')) ?? ''), 'core', CORE_MAP);
  leafValues(parseXml((await z.text('docProps/app.xml')) ?? ''), 'app', APP_MAP, (t) =>
    t.replace(/^.*:/, '').toLowerCase(),
  );
  for (const p of descendants(parseXml((await z.text('docProps/custom.xml')) ?? ''), 'property')) {
    const name = p.attrs.name ?? '';
    const value = textOf(p).trim();
    if (name && value)
      entries.push({
        where: `custom/${name}`,
        value,
        cat: COMPANY_KEYS.test(name) ? 'company' : 'custom',
      });
  }
  // TotalTime is minutes of editing; make it readable.
  for (const e of entries)
    if (e.where.endsWith('TotalTime')) e.value = `${e.value} minutes of editing`;

  const paths = new Map<string, string[]>();
  for (const e of entries) {
    const p = findFilePath(e.value);
    if (p) paths.set(p, [...(paths.get(p) ?? []), e.where]);
  }
  for (const [p, where] of paths) addPath(sink, p, where.join(', '));

  for (const cat of Object.keys(META) as MetaCat[]) {
    const list = entries.filter((e) => e.cat === cat);
    if (!list.length) continue;
    const values = new Map<string, string[]>();
    for (const e of list) values.set(e.value, [...(values.get(e.value) ?? []), e.where]);
    const t = META[cat];
    sink.add({
      rule: t.rule,
      detector: 'docx-metadata',
      severity: t.severity,
      title: t.title,
      evidence: [...values].map(([v, w]) => `${w.join(', ')}: ${v}`).join('\n'),
      fix: t.fix,
      details: { fields: Object.fromEntries([...values].map(([v, w]) => [w.join(', '), v])) },
    });
  }
}

function addPath(sink: FindingSink, p: string, where: string) {
  const user = usernameFromPath(p);
  sink.add({
    rule: 'docx.file-path',
    detector: 'docx-metadata',
    severity: 'medium',
    title: `The document contains a path from the computer it was made on${user ? `, which reveals the username "${user}"` : ''}.`,
    evidence: p,
    fix: 'Run `redactguard clean` to strip properties, template links and linked-file paths.',
    details: { source: where },
  });
}

async function relsTargets(
  z: Zip,
  relsPart: string,
): Promise<{ id: string; target: string; type: string; external: boolean }[]> {
  return [...descendants(parseXml((await z.text(relsPart)) ?? ''), 'Relationship')].map((r) => ({
    id: r.attrs.Id ?? '',
    target: r.attrs.Target ?? '',
    type: r.attrs.Type ?? '',
    external: r.attrs.TargetMode === 'External',
  }));
}

async function detectSettings(z: Zip, wordDir: string, sink: FindingSink) {
  const nodes = parseXml((await z.text(`${wordDir}/settings.xml`)) ?? '');
  const tpl = [...descendants(nodes, 'w:attachedTemplate')][0]?.attrs['r:id'];
  if (tpl) {
    const rel = (await relsTargets(z, `${wordDir}/_rels/settings.xml.rels`)).find(
      (r) => r.id === tpl,
    );
    if (rel?.target) {
      const p = findFilePath(decodeURIComponent(rel.target)) ?? rel.target;
      addPath(sink, p, 'attached template');
    }
  }
  const vars = [...descendants(nodes, 'w:docVar')]
    .map((v) => `${v.attrs['w:name'] ?? '?'} = ${v.attrs['w:val'] ?? ''}`)
    .filter((s) => s.trim() !== '? =');
  if (vars.length) {
    sink.add({
      rule: 'docx.document-variables',
      detector: 'docx-metadata',
      severity: 'low',
      title: 'The document stores hidden document variables (often written by macros or add-ins).',
      evidence: vars.join('\n'),
      fix: 'Run `redactguard clean` to remove document variables.',
    });
  }
}

async function detectPackageParts(z: Zip, wordDir: string, sink: FindingSink, warnings: string[]) {
  // Linked files on disk (external relationships pointing at local paths).
  for (const relsPart of z.names.filter((n) => n.endsWith('.rels'))) {
    if (relsPart.endsWith('settings.xml.rels')) continue; // handled as template
    for (const r of await relsTargets(z, relsPart)) {
      if (!r.external) continue;
      let target = r.target;
      try {
        target = decodeURIComponent(target);
      } catch {
        /* keep raw */
      }
      const p = findFilePath(target);
      if (p) addPath(sink, p, `linked ${path.basename(r.type) || 'file'} (${relsPart})`);
    }
  }

  // Custom XML data parts.
  const custom = z.names.filter((n) => /^customXml\/item\d+\.xml$/i.test(n)).sort();
  const items: string[] = [];
  for (const n of custom) {
    const nodes = parseXml((await z.text(n)) ?? '');
    const text = leafTexts(nodes).join(' · ');
    if (text) items.push(`${n}: ${truncate(text, 200)}`);
  }
  if (items.length) {
    sink.add({
      rule: 'docx.custom-xml',
      detector: 'docx-metadata',
      severity: 'low',
      title: 'The document carries custom XML data (often from SharePoint, templates or add-ins).',
      evidence: items.join('\n'),
      fix: 'Run `redactguard clean` to remove custom XML parts.',
    });
  }

  // Embedded objects (whole spreadsheets, other documents).
  const embeds = z.names
    .filter((n) => n.toLowerCase().startsWith(`${wordDir}/embeddings/`.toLowerCase()))
    .sort();
  if (embeds.length) {
    const lines = embeds.map((n) => `${n} (${Math.max(1, Math.round(z.size(n) / 1024))} KB)`);
    const sheet = embeds.some((n) => /\.(xlsx?|xlsm|csv)$/i.test(n) || /Worksheet/i.test(n));
    sink.add({
      rule: 'docx.embedded-object',
      detector: 'docx-metadata',
      severity: 'medium',
      title: sheet
        ? 'The document embeds a spreadsheet or other file. Embedded charts often carry the entire source spreadsheet, not just what is shown.'
        : 'The document embeds other files. Their full contents travel with the document.',
      evidence: lines.join('\n'),
      fix: 'Paste charts as pictures, or run `redactguard clean` to remove embedded objects.',
      details: { parts: embeds },
    });
  }

  // Macros.
  const vba = z.names.filter((n) => /vbaProject\.bin$/i.test(n));
  if (vba.length) {
    sink.add({
      rule: 'docx.macros',
      detector: 'docx-metadata',
      severity: 'medium',
      title:
        'The document contains macros (VBA code). Macro code can include names, paths and other data.',
      evidence: vba.join('\n'),
      fix: 'Save as a plain .docx (not .docm), or run `redactguard clean`.',
    });
  }

  // Images: run the image detectors on each one.
  const media = z.names
    .filter((n) => n.toLowerCase().startsWith(`${wordDir}/media/`.toLowerCase()))
    .sort();
  let scanned = 0;
  for (const n of media) {
    if (scanned >= MAX_IMAGES) {
      warnings.push(`Only the first ${MAX_IMAGES} images were checked.`);
      break;
    }
    const b = await z.bytes(n);
    if (!b || !sniffImage(b)) continue;
    scanned++;
    await analyzeImage(b, sink, warnings, { source: n });
  }
}

/** Non-empty text values of an XML tree, one per element. */
function leafTexts(nodes: XNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.tag === '#text') {
      const v = (n.text ?? '').replace(/\s+/g, ' ').trim();
      if (v) out.push(v);
    } else out.push(...leafTexts(n.children));
  }
  return out;
}
