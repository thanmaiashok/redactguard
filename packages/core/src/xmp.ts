import { XMLParser } from 'fast-xml-parser';

export interface XmpEntry {
  /** Qualified name, lower-cased, e.g. `dc:creator`, `xmp:creatortool`. */
  key: string;
  value: string;
}

const STRUCTURAL = new Set([
  'x:xmpmeta',
  'x:xapmeta',
  'rdf:rdf',
  'rdf:description',
  'rdf:seq',
  'rdf:bag',
  'rdf:alt',
  'rdf:li',
  '#text',
]);

/** Flattens an XMP packet into (property, value) pairs. Never throws. */
export function parseXmp(xml: string): XmpEntry[] {
  const out: XmpEntry[] = [];
  let tree: unknown;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      removeNSPrefix: false,
      processEntities: true,
      htmlEntities: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    });
    tree = parser.parse(xml.replace(/<\?xpacket[^>]*\?>/g, ''));
  } catch {
    return out;
  }
  const walk = (node: unknown, prop: string | null) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      const v = String(node).trim();
      if (prop && v) out.push({ key: prop, value: v });
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) walk(n, prop);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith('@')) {
        const name = k.slice(1).toLowerCase();
        if (
          name.startsWith('xmlns') ||
          name.startsWith('rdf:') ||
          name.startsWith('x:') ||
          name === 'xml:lang'
        )
          continue;
        walk(v, name);
        continue;
      }
      const lk = k.toLowerCase();
      walk(v, STRUCTURAL.has(lk) ? prop : lk);
    }
  };
  walk(tree, null);
  return out;
}
