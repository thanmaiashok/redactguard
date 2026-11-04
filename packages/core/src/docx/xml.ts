import { XMLParser } from 'fast-xml-parser';

/** One element in document order: tag name, attributes, children. Text nodes have tag '#text'. */
export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text?: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

type Raw = Record<string, unknown>;

function convert(list: unknown): XNode[] {
  if (!Array.isArray(list)) return [];
  const out: XNode[] = [];
  for (const item of list as Raw[]) {
    const attrs = (item[':@'] as Record<string, string> | undefined) ?? {};
    for (const [k, v] of Object.entries(item)) {
      if (k === ':@') continue;
      if (k === '#text') out.push({ tag: '#text', attrs: {}, children: [], text: String(v) });
      else out.push({ tag: k, attrs, children: convert(v) });
    }
  }
  return out;
}

/** Parses XML into ordered nodes. Returns [] for malformed XML instead of throwing. */
export function parseXml(xml: string): XNode[] {
  try {
    return convert(parser.parse(xml));
  } catch {
    return [];
  }
}

export function* descendants(nodes: XNode[], tag?: string): Generator<XNode> {
  for (const n of nodes) {
    if (!tag || n.tag === tag) yield n;
    yield* descendants(n.children, tag);
  }
}

export function child(n: XNode, tag: string): XNode | undefined {
  return n.children.find((c) => c.tag === tag);
}

/** All text below a node (for simple elements like `<dc:creator>`). */
export function textOf(n: XNode): string {
  if (n.tag === '#text') return n.text ?? '';
  return n.children.map(textOf).join('');
}

/** Word on/off attribute: `<w:vanish/>` is on, `<w:vanish w:val="0"/>` is off. */
export function isOn(n: XNode | undefined): boolean {
  if (!n) return false;
  const v = n.attrs['w:val'];
  return v === undefined || !['0', 'false', 'off', 'none'].includes(v.toLowerCase());
}
