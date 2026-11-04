/**
 * Image checks, shared by plain image files and images embedded in PDF / DOCX files:
 * EXIF / IPTC / XMP / PNG-text metadata, GPS, thumbnails that differ, and pixelation risk.
 */
// exifr is only ever given bytes, never a URL or path, so its URL/file readers are never used.
import exifr from 'exifr';
import type { BBox, Severity } from '../types.js';
import { FindingSink, findFilePath, usernameFromPath } from '../util.js';
import { parseXmp } from '../xmp.js';
import { type Pixels, decodeImage, grayResize } from './decode.js';
import { detectMosaic, pixelationRisk } from './pixelation.js';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'gif' | 'tiff';

export function sniffImage(b: Uint8Array): ImageFormat | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const s = Buffer.from(b.subarray(0, 12)).toString('latin1');
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.slice(4, 8) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)/.test(s.slice(8, 12)))
    return 'heic';
  if (s.startsWith('GIF8')) return 'gif';
  if (s.startsWith('II*\0') || s.startsWith('MM\0*')) return 'tiff';
  return null;
}

export interface ImageContext {
  /** Where the image lives inside a container file, e.g. `word/media/image1.png`. */
  source?: string;
  page?: number;
  /** Where the image is drawn on a PDF page (points). */
  bbox?: BBox;
  /** Already-decoded pixels (PDF images come decoded from pdf.js). */
  pixels?: Pixels | null;
  /** Report "could not analyse pixels" as a warning (top-level image files only). */
  warnPixels?: boolean;
  /** Maps a pixel region to page coordinates (PDF images). */
  mapRegion?: (r: { x: number; y: number; width: number; height: number }) => BBox;
}

type Category =
  | 'gps'
  | 'location'
  | 'author'
  | 'serial'
  | 'ai-prompt'
  | 'computer'
  | 'device'
  | 'software'
  | 'dates'
  | 'description'
  | 'copyright'
  | 'history'
  | 'ids';

interface Entry {
  where: string;
  value: string;
  category: Category;
}

const EXIF_MAP: Record<string, Category> = {
  Artist: 'author',
  XPAuthor: 'author',
  OwnerName: 'author',
  CameraOwnerName: 'author',
  SerialNumber: 'serial',
  BodySerialNumber: 'serial',
  LensSerialNumber: 'serial',
  InternalSerialNumber: 'serial',
  CameraSerialNumber: 'serial',
  ImageUniqueID: 'ids',
  HostComputer: 'computer',
  Make: 'device',
  Model: 'device',
  LensMake: 'device',
  LensModel: 'device',
  Software: 'software',
  ProcessingSoftware: 'software',
  DateTimeOriginal: 'dates',
  CreateDate: 'dates',
  ModifyDate: 'dates',
  DateTime: 'dates',
  OffsetTimeOriginal: 'dates',
  GPSDateStamp: 'dates',
  ImageDescription: 'description',
  UserComment: 'description',
  XPComment: 'description',
  XPTitle: 'description',
  XPSubject: 'description',
  XPKeywords: 'description',
  DocumentName: 'description',
  Copyright: 'copyright',
};

const IPTC_RULES: [RegExp, Category][] = [
  [/^(by-?line|creator|writer|contact)/i, 'author'],
  [/^(city|state|province|country|sub-?location|location)/i, 'location'],
  [/^(caption|headline|keywords|object-?name|special-?instructions|title)/i, 'description'],
  [/^(copyright|credit|source)/i, 'copyright'],
  [/date|time/i, 'dates'],
];

const XMP_RULES: [RegExp, Category][] = [
  [/^exif:gps(latitude|longitude)$/, 'gps'],
  [
    /^(dc:creator|xmp:author|photoshop:authorsposition|iptc4xmpcore:creatorcontactinfo|xmprights:owner)/,
    'author',
  ],
  [
    /^(photoshop:(city|state|country)|iptc4xmpcore:(location|countrycode)|iptc4xmpext:location)/,
    'location',
  ],
  [
    /^(aux:serialnumber|exifex:bodyserialnumber|exifex:lensserialnumber|exifex:cameraownername)/,
    'serial',
  ],
  [/^(xmp:creatortool)$/, 'software'],
  [/^(stevt:|photoshop:history|xmpmm:history)/, 'history'],
  [/^(xmpmm:|stref:)/, 'ids'],
  [
    /^(xmp:(createdate|modifydate|metadatadate)|photoshop:datecreated|exif:datetimeoriginal)$/,
    'dates',
  ],
  [/^(dc:(description|title|subject)|photoshop:headline|exif:usercomment)$/, 'description'],
  [/^(dc:rights|xmprights:)/, 'copyright'],
];

const PNG_TEXT_RULES: [RegExp, Category][] = [
  [/^(parameters|prompt|workflow|dream|sd-metadata|negative.?prompt|comfy|invokeai)/i, 'ai-prompt'],
  [/^(author|artist|creator)$/i, 'author'],
  [/^software$/i, 'software'],
  [/^(creation time|date)/i, 'dates'],
  [/^copyright$/i, 'copyright'],
];

const IHDR_TECH = new Set([
  'ImageWidth',
  'ImageHeight',
  'BitDepth',
  'ColorType',
  'Compression',
  'Filter',
  'Interlace',
]);

const TEXT: Record<
  Category,
  { rule: string; severity: Severity; title: (s: string) => string; fix: string }
> = {
  gps: {
    rule: 'image.gps',
    severity: 'high',
    title: (s) =>
      `${s} contains GPS coordinates. This reveals where it was taken, possibly your home.`,
    fix: 'Run `redactguard clean` to strip all metadata, or turn off location tagging in your camera app.',
  },
  location: {
    rule: 'image.location',
    severity: 'medium',
    title: (s) => `${s} names a place (city, country or location) in its hidden metadata.`,
    fix: 'Run `redactguard clean` to strip all metadata.',
  },
  author: {
    rule: 'image.author',
    severity: 'medium',
    title: (s) => `${s} records a person's name (author, artist or camera owner).`,
    fix: 'Run `redactguard clean` to strip all metadata.',
  },
  serial: {
    rule: 'image.camera-serial',
    severity: 'medium',
    title: (s) =>
      `${s} contains a camera or lens serial number, which can link it to your other photos.`,
    fix: 'Run `redactguard clean` to strip all metadata.',
  },
  'ai-prompt': {
    rule: 'image.ai-prompt',
    severity: 'medium',
    title: (s) => `${s} contains the AI prompt and settings used to generate it.`,
    fix: 'Run `redactguard clean` to strip text chunks and metadata.',
  },
  computer: {
    rule: 'image.computer-name',
    severity: 'medium',
    title: (s) => `${s} records the name of the computer it was made on.`,
    fix: 'Run `redactguard clean` to strip all metadata.',
  },
  device: {
    rule: 'image.device',
    severity: 'low',
    title: (s) => `${s} records the camera or phone model.`,
    fix: 'Run `redactguard clean` to strip all metadata.',
  },
  software: {
    rule: 'image.software',
    severity: 'low',
    title: (s) => `${s} records which software created or edited it.`,
    fix: 'Run `redactguard clean` to strip all metadata.',
  },
  dates: {
    rule: 'image.dates',
    severity: 'low',
    title: (s) => `${s} records when it was taken or edited.`,
    fix: 'Run `redactguard clean` if the timing is sensitive.',
  },
  description: {
    rule: 'image.description',
    severity: 'low',
    title: (s) => `${s} has a hidden caption, comment, title or keywords.`,
    fix: 'Check the text below. Run `redactguard clean` to strip it.',
  },
  copyright: {
    rule: 'image.copyright',
    severity: 'low',
    title: (s) => `${s} has copyright or credit information.`,
    fix: 'Usually intended. Run `redactguard clean` if it should not be there.',
  },
  history: {
    rule: 'image.edit-history',
    severity: 'low',
    title: (s) => `${s} keeps an edit history (which programs touched it and when).`,
    fix: 'Run `redactguard clean` to strip XMP metadata.',
  },
  ids: {
    rule: 'image.document-ids',
    severity: 'low',
    title: (s) => `${s} carries IDs that can link it to the original it was made from.`,
    fix: 'Run `redactguard clean` to strip XMP metadata.',
  },
};

function str(v: unknown, key = ''): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.replace(/\0+$/g, '').trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Uint8Array) {
    // Windows XP* tags are UTF-16LE.
    if (key.startsWith('XP')) return Buffer.from(v).toString('utf16le').replace(/\0+$/g, '').trim();
    return '';
  }
  if (Array.isArray(v))
    return v
      .map((x) => str(x))
      .filter(Boolean)
      .join(', ');
  return '';
}

/** Raw XMP packet anywhere in the bytes (JPEG APP1, PNG iTXt, WebP, HEIC, TIFF). */
export function findXmp(bytes: Uint8Array): string | null {
  const s = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const start = s.indexOf('<x:xmpmeta');
  if (start < 0) return null;
  const end = s.indexOf('</x:xmpmeta>', start);
  if (end < 0) return null;
  return Buffer.from(s.slice(start, end + 12), 'latin1').toString('utf8');
}

/** WebP keeps EXIF in a RIFF chunk; exifr reads TIFF bytes directly. */
export function webpExif(bytes: Uint8Array): Uint8Array | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('latin1', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'EXIF') {
      let data = b.subarray(off + 8, Math.min(b.length, off + 8 + size));
      if (data.toString('latin1', 0, 6) === 'Exif\0\0') data = data.subarray(6);
      return new Uint8Array(data);
    }
    off += 8 + size + (size & 1);
  }
  return null;
}

async function readExif(bytes: Uint8Array, format: ImageFormat) {
  const input = format === 'webp' ? webpExif(bytes) : bytes;
  if (!input) return null;
  try {
    return (await exifr.parse(Buffer.from(input), {
      tiff: true,
      exif: true,
      gps: true,
      ifd1: false,
      interop: false,
      xmp: false,
      iptc: true,
      icc: false,
      jfif: false,
      ihdr: true,
      makerNote: false,
      userComment: true,
      mergeOutput: false,
      translateKeys: true,
      translateValues: true,
      reviveValues: false,
      sanitize: true,
    })) as Record<string, Record<string, unknown>> | undefined;
  } catch {
    return null;
  }
}

function dmsToDeg(v: unknown, ref: unknown): number | null {
  if (!Array.isArray(v) || v.length < 1) return null;
  const [d = 0, m = 0, s = 0] = v.map(Number);
  if (![d, m, s].every(Number.isFinite)) return null;
  const deg = d + m / 60 + s / 3600;
  return ref === 'S' || ref === 'W' ? -deg : deg;
}

export async function analyzeImage(
  bytes: Uint8Array,
  sink: FindingSink,
  warnings: string[],
  ctx: ImageContext = {},
): Promise<void> {
  const format = sniffImage(bytes);
  const subject = ctx.source ? `An image inside this file (${ctx.source})` : 'This image';
  const loc = {
    ...(ctx.page ? { page: ctx.page } : {}),
    ...(ctx.bbox ? { bbox: ctx.bbox } : {}),
  };
  const baseDetails = ctx.source ? { source: ctx.source } : {};
  const entries: Entry[] = [];

  if (format) {
    const ex = await readExif(bytes, format);
    if (ex) {
      for (const seg of ['ifd0', 'exif', 'gps'] as const) {
        for (const [k, v] of Object.entries(ex[seg] ?? {})) {
          const cat = EXIF_MAP[k];
          const value = str(v, k);
          if (cat && value) entries.push({ where: `EXIF/${k}`, value, category: cat });
        }
      }
      const gps = ex.gps;
      if (gps) {
        const lat = dmsToDeg(gps.GPSLatitude, gps.GPSLatitudeRef);
        const lon = dmsToDeg(gps.GPSLongitude, gps.GPSLongitudeRef);
        if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
          const alt = Number(gps.GPSAltitude);
          const value =
            `${lat.toFixed(5)}, ${lon.toFixed(5)}` +
            ` (${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'})` +
            (Number.isFinite(alt) && gps.GPSAltitude !== undefined ? `, altitude ${alt} m` : '');
          entries.push({ where: 'EXIF/GPS', value, category: 'gps' });
        }
      }
      for (const [k, v] of Object.entries(ex.iptc ?? {})) {
        const value = str(v);
        const cat = IPTC_RULES.find(([re]) => re.test(k))?.[1];
        if (cat && value) entries.push({ where: `IPTC/${k}`, value, category: cat });
      }
      if (format === 'png') {
        for (const [k, v] of Object.entries(ex.ihdr ?? {})) {
          if (IHDR_TECH.has(k)) continue;
          const value = str(v);
          if (!value) continue;
          const cat = PNG_TEXT_RULES.find(([re]) => re.test(k))?.[1] ?? 'description';
          entries.push({ where: `PNG text/${k}`, value, category: cat });
        }
      }
    }
    const xmp = findXmp(bytes);
    if (xmp) {
      for (const { key, value } of parseXmp(xmp)) {
        const cat = XMP_RULES.find(([re]) => re.test(key))?.[1];
        if (cat) entries.push({ where: `XMP/${key}`, value, category: cat });
      }
    }
  }

  // File paths anywhere in metadata.
  const paths = new Map<string, string[]>();
  for (const e of entries) {
    const p = findFilePath(e.value);
    if (p) paths.set(p, [...(paths.get(p) ?? []), e.where]);
  }
  for (const [p, where] of paths) {
    const user = usernameFromPath(p);
    sink.add({
      rule: 'image.file-path',
      detector: 'image-metadata',
      severity: 'medium',
      title: `${subject} contains a file path from the computer it was made on${user ? `, revealing the username "${user}"` : ''}.`,
      ...loc,
      evidence: p,
      fix: 'Run `redactguard clean` to strip all metadata.',
      details: { ...baseDetails, fields: where },
    });
  }

  const order: Category[] = [
    'gps',
    'location',
    'author',
    'serial',
    'ai-prompt',
    'computer',
    'description',
    'device',
    'software',
    'dates',
    'copyright',
    'history',
    'ids',
  ];
  for (const cat of order) {
    const list = entries.filter((e) => e.category === cat);
    if (!list.length) continue;
    const values = new Map<string, string[]>();
    for (const e of list) values.set(e.value, [...(values.get(e.value) ?? []), e.where]);
    const t = TEXT[cat];
    sink.add({
      rule: t.rule,
      detector: 'image-metadata',
      severity: t.severity,
      title: t.title(subject),
      ...loc,
      evidence: [...values].map(([v, w]) => `${w.join(', ')}: ${v}`).join('\n'),
      fix: t.fix,
      details: {
        ...baseDetails,
        fields: Object.fromEntries([...values].map(([v, w]) => [w.join(', '), v])),
      },
    });
  }

  // Pixels: pixelation and thumbnail checks.
  let pixels = ctx.pixels ?? null;
  if (!pixels && format && format !== 'heic' && format !== 'tiff')
    pixels = await decodeImage(bytes);
  if (!pixels) {
    if (ctx.warnPixels && format) {
      warnings.push(
        format === 'heic'
          ? 'HEIC pixels cannot be decoded offline here; pixelation and thumbnail checks were skipped.'
          : 'Image pixels could not be decoded; pixelation and thumbnail checks were skipped.',
      );
    }
    return;
  }

  if (format === 'jpeg' || format === 'tiff')
    await checkThumbnail(bytes, pixels, sink, subject, loc, baseDetails);

  for (const r of detectMosaic(pixels)) {
    const { risk, textHeight } = pixelationRisk(r);
    sink.add({
      rule: 'image.pixelation',
      detector: 'pixelation',
      severity: risk,
      title:
        risk === 'high'
          ? `${subject} has a pixelated area with small blocks. Pixelated text this fine has been reversed in published research. Use a solid box instead.`
          : `${subject} has a pixelated area. Pixelation is weaker than a solid box and can sometimes be reversed.`,
      ...loc,
      ...(ctx.mapRegion ? { bbox: ctx.mapRegion(r) } : {}),
      evidence: `Pixelated area at x=${r.x}, y=${r.y}, ${r.width}×${r.height} px, block size ${r.block} px${textHeight ? ` (text roughly ${textHeight} px tall)` : ''}`,
      fix: 'Cover the area with a solid box instead, e.g. `redactguard clean --fix-pixelation` with these coordinates.',
      details: {
        ...baseDetails,
        region: { x: r.x, y: r.y, width: r.width, height: r.height },
        block: r.block,
        units: 'px',
      },
    });
  }
}

async function checkThumbnail(
  bytes: Uint8Array,
  main: Pixels,
  sink: FindingSink,
  subject: string,
  loc: object,
  baseDetails: object,
) {
  let thumbBytes: Uint8Array | undefined;
  try {
    thumbBytes = await exifr.thumbnail(Buffer.from(bytes));
  } catch {
    return;
  }
  if (!thumbBytes || thumbBytes.length < 100) return;
  const thumb = await decodeImage(thumbBytes);
  if (!thumb) return;
  const mainAspect = main.width / main.height;
  const thumbAspect = thumb.width / thumb.height;
  const aspectDiff = Math.abs(mainAspect - thumbAspect) / mainAspect;
  // Compare on a small grid.
  const W = 32;
  const H = Math.max(4, Math.round(W / thumbAspect));
  const a = grayResize(main, W, H);
  const b = grayResize(thumb, W, H);
  let sum = 0;
  let maxCell = 0;
  const cell = new Float32Array(16);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.abs(a[y * W + x]! - b[y * W + x]!);
      sum += d;
      cell[Math.floor((y * 4) / H) * 4 + Math.floor((x * 4) / W)]! += d;
    }
  const perCell = (W * H) / 16;
  for (const c of cell) maxCell = Math.max(maxCell, c / perCell);
  const meanDiff = sum / (W * H);
  const differs = aspectDiff > 0.08 || meanDiff > 25 || maxCell > 60;
  sink.add({
    rule: differs ? 'image.thumbnail-mismatch' : 'image.thumbnail',
    detector: 'image-metadata',
    severity: differs ? 'high' : 'info',
    title: differs
      ? `${subject} has a hidden preview thumbnail that does not match the picture. It may still show what you cropped out or edited away.`
      : `${subject} carries a small hidden preview thumbnail.`,
    ...loc,
    evidence: `Thumbnail ${thumb.width}×${thumb.height} px, image ${main.width}×${main.height} px${differs ? (aspectDiff > 0.08 ? ': different shape (the picture was cropped)' : ': different content') : ''}`,
    fix: 'Run `redactguard clean`, which re-encodes the image without the thumbnail.',
    details: {
      ...baseDetails,
      aspectDiff: Number(aspectDiff.toFixed(3)),
      meanDiff: Math.round(meanDiff),
      maxCellDiff: Math.round(maxCell),
    },
  });
}
