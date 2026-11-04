import type { Severity } from '../../types.js';
import { FindingSink, findFilePath, usernameFromPath } from '../../util.js';
import { parseXmp } from '../../xmp.js';
import type { LoadedPdf } from '../load.js';

type Category =
  'author' | 'company' | 'software' | 'dates' | 'title' | 'ids' | 'history' | 'custom';

interface Entry {
  source: 'Info' | 'XMP';
  key: string;
  value: string;
  category: Category;
}

const INFO_MAP: Record<string, Category> = {
  Author: 'author',
  Creator: 'software',
  Producer: 'software',
  CreationDate: 'dates',
  ModDate: 'dates',
  Title: 'title',
  Subject: 'title',
  Keywords: 'title',
};

const XMP_MAP: Record<string, Category> = {
  'dc:creator': 'author',
  'pdf:author': 'author',
  'xmp:author': 'author',
  'photoshop:authorsposition': 'author',
  'xmp:creatortool': 'software',
  'pdf:producer': 'software',
  'xmp:createdate': 'dates',
  'xmp:modifydate': 'dates',
  'xmp:metadatadate': 'dates',
  'dc:title': 'title',
  'dc:description': 'title',
  'dc:subject': 'title',
  'pdf:keywords': 'title',
  'xmpmm:documentid': 'ids',
  'xmpmm:instanceid': 'ids',
  'xmpmm:originaldocumentid': 'ids',
  'stref:documentid': 'ids',
  'stref:instanceid': 'ids',
  'stevt:action': 'history',
  'stevt:when': 'history',
  'stevt:softwareagent': 'history',
  'stevt:changed': 'history',
  'stevt:instanceid': 'history',
  'stevt:parameters': 'history',
};

const IGNORE_XMP =
  /^(pdf:pdfversion|pdf:trapped|xmptpg:|pdfaid:|dc:format|xmp:rating|xmpmm:versionid|xmpmm:renditionclass)/;

const COMPANY_KEYS = /company|organi[sz]ation|manager|department|employer|client/i;

const TEXT: Record<Category, { rule: string; severity: Severity; title: string; fix: string }> = {
  author: {
    rule: 'pdf.metadata.author',
    severity: 'medium',
    title: 'The file names its author. Anyone who opens Document Properties can see who wrote it.',
    fix: 'Clear the Author field (File → Properties) or run `redactguard clean`, which strips all metadata.',
  },
  company: {
    rule: 'pdf.metadata.company',
    severity: 'medium',
    title: 'The file names a company, client or manager in its hidden properties.',
    fix: 'Remove custom document properties or run `redactguard clean`.',
  },
  software: {
    rule: 'pdf.metadata.software',
    severity: 'low',
    title:
      'The file records which programs created it. This hints at your setup and how the file was made.',
    fix: 'Run `redactguard clean` to strip creator and producer fields.',
  },
  dates: {
    rule: 'pdf.metadata.dates',
    severity: 'low',
    title: 'The file records when it was created and last changed.',
    fix: 'Run `redactguard clean` to strip dates if the timeline is sensitive.',
  },
  title: {
    rule: 'pdf.metadata.title',
    severity: 'low',
    title:
      'The file has a hidden title, subject or keywords. These often keep an older or internal name.',
    fix: 'Check the text below. Clear it in File → Properties or run `redactguard clean`.',
  },
  ids: {
    rule: 'pdf.metadata.document-ids',
    severity: 'low',
    title: 'The file carries document IDs that can link it back to the original it was made from.',
    fix: 'Run `redactguard clean` to strip XMP metadata.',
  },
  history: {
    rule: 'pdf.metadata.edit-history',
    severity: 'low',
    title: 'The file keeps an edit history: which programs touched it and when.',
    fix: 'Run `redactguard clean` to strip XMP metadata.',
  },
  custom: {
    rule: 'pdf.metadata.custom',
    severity: 'low',
    title: 'The file has extra custom properties hidden in its metadata.',
    fix: 'Review the values below. Run `redactguard clean` to strip them.',
  },
};

export async function detectMetadata(pdf: LoadedPdf, sink: FindingSink): Promise<void> {
  const entries: Entry[] = [];
  let meta: Awaited<ReturnType<typeof pdf.doc.getMetadata>>;
  try {
    meta = await pdf.doc.getMetadata();
  } catch {
    return;
  }
  const info = (meta.info ?? {}) as Record<string, unknown>;
  const fmtDate = (v: string) => {
    try {
      const d = pdf.pdfjs.PDFDateString.toDateObject(v);
      return d ? d.toISOString() : v;
    } catch {
      return v;
    }
  };
  for (const [key, raw] of Object.entries(info)) {
    if (key === 'Custom' && raw && typeof raw === 'object') {
      const pairs =
        raw instanceof Map ? [...raw.entries()] : Object.entries(raw as Record<string, unknown>);
      for (const [ck, cv] of pairs as [string, unknown][]) {
        const value = stringify(cv);
        if (!value) continue;
        entries.push({
          source: 'Info',
          key: ck,
          value,
          category: COMPANY_KEYS.test(ck) ? 'company' : 'custom',
        });
      }
      continue;
    }
    const category = INFO_MAP[key];
    if (!category) continue;
    let value = stringify(raw);
    if (!value) continue;
    if (category === 'dates') value = fmtDate(value);
    entries.push({ source: 'Info', key, value, category });
  }

  const rawXmp = meta.metadata?.getRaw?.();
  if (typeof rawXmp === 'string' && rawXmp.trim()) {
    for (const { key, value } of parseXmp(rawXmp)) {
      if (IGNORE_XMP.test(key)) continue;
      const category = XMP_MAP[key] ?? (COMPANY_KEYS.test(key) ? 'company' : 'custom');
      entries.push({ source: 'XMP', key, value, category });
    }
  }

  // File paths anywhere in metadata are their own finding: they leak usernames and folder names.
  const paths = new Map<string, string[]>();
  for (const e of entries) {
    const p = findFilePath(e.value);
    if (p) paths.set(p, [...(paths.get(p) ?? []), `${e.source}/${e.key}`]);
  }
  for (const [p, where] of paths) {
    const user = usernameFromPath(p);
    sink.add({
      rule: 'pdf.metadata.file-path',
      detector: 'metadata',
      severity: 'medium',
      title: `The file contains a path from the computer it was made on${user ? `, which reveals the username "${user}"` : ''}.`,
      evidence: p,
      fix: 'Run `redactguard clean` to strip all metadata.',
      details: { fields: where },
    });
  }

  // One finding per category, values de-duplicated across Info and XMP.
  const order: Category[] = [
    'author',
    'company',
    'title',
    'custom',
    'software',
    'dates',
    'ids',
    'history',
  ];
  for (const cat of order) {
    const list = entries.filter((e) => e.category === cat);
    if (list.length === 0) continue;
    const values = new Map<string, string[]>();
    for (const e of list)
      values.set(e.value, [...(values.get(e.value) ?? []), `${e.source}/${e.key}`]);
    const t = TEXT[cat];
    const lines = [...values].map(([v, w]) => `${w.join(', ')}: ${v}`);
    sink.add({
      rule: t.rule,
      detector: 'metadata',
      severity: t.severity,
      title: t.title,
      evidence: lines.join('\n'),
      fix: t.fix,
      details: { fields: Object.fromEntries([...values].map(([v, w]) => [w.join(', '), v])) },
    });
  }
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && 'name' in (v as object))
    return String((v as { name: unknown }).name);
  return '';
}
