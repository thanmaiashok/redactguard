/**
 * Synthetic images for tests. Content is drawn with shapes (no fonts), so it renders the same on
 * every OS. All metadata values are fake.
 */
import { crc32 } from 'node:zlib';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import piexif from 'piexifjs';

/** Deterministic PRNG. */
export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Draws letter-like dark shapes, like a line of text. Whole pixels only, so output is identical on every OS. */
export function drawFakeText(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
) {
  const r = rng(seed);
  let cx = x;
  ctx.fillStyle = '#1a1a1a';
  while (cx < x + w - 6) {
    const gw = 3 + Math.floor(r() * 7);
    const gh = Math.round(h * (0.55 + r() * 0.45));
    ctx.fillRect(Math.round(cx), y + (h - gh), gw, gh);
    if (r() < 0.5) ctx.fillRect(Math.round(cx + gw / 2), y, 2, Math.round(h * 0.4));
    cx += gw + 1 + Math.floor(r() * 3);
    if (r() < 0.15) cx += 6; // word gap
  }
}

/** Replaces a region with a mosaic of block x block averages (what "pixelate" tools do). */
export function pixelate(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  block: number,
) {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const bw = Math.min(block, w - bx);
      const bh = Math.min(block, h - by);
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let yy = 0; yy < bh; yy++)
        for (let xx = 0; xx < bw; xx++) {
          const i = ((by + yy) * w + bx + xx) * 4;
          r += d[i]!;
          g += d[i + 1]!;
          bl += d[i + 2]!;
        }
      const n = bw * bh;
      for (let yy = 0; yy < bh; yy++)
        for (let xx = 0; xx < bw; xx++) {
          const i = ((by + yy) * w + bx + xx) * 4;
          d[i] = Math.round(r / n);
          d[i + 1] = Math.round(g / n);
          d[i + 2] = Math.round(bl / n);
        }
    }
  }
  ctx.putImageData(img, x, y);
}

/** A screenshot-like image: a header bar, a few lines of "text", and an optional mosaic. */
export function screenshot(opts: { pixelateBlock?: number; seed?: number } = {}) {
  const c = createCanvas(480, 200);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 480, 200);
  ctx.fillStyle = '#3b6fd8';
  ctx.fillRect(0, 0, 480, 28);
  for (let i = 0; i < 5; i++) drawFakeText(ctx, 16, 44 + i * 30, 440, 16, (opts.seed ?? 7) + i);
  if (opts.pixelateBlock) pixelate(ctx, 120, 72, 216, 30, opts.pixelateBlock);
  return c;
}

/** A photo-like image: smooth gradient plus noise (must not look pixelated). */
export function photo(seed = 3, w = 320, h = 240, label = '') {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const r = rng(seed);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = (r() - 0.5) * 30;
      img.data[i] = Math.max(0, Math.min(255, 90 + (x / w) * 120 + n));
      img.data[i + 1] = Math.max(0, Math.min(255, 140 + (y / h) * 80 + n));
      img.data[i + 2] = Math.max(0, Math.min(255, 200 - (x / w) * 100 + n));
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  if (label) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(w * 0.1, h * 0.4, w * 0.8, h * 0.2);
  }
  return c;
}

const toBinary = (b: Uint8Array) => Buffer.from(b).toString('binary');
const fromBinary = (s: string) => new Uint8Array(Buffer.from(s, 'binary'));

/** A JPEG whose EXIF thumbnail is simply a smaller copy of the image (the normal case). */
export function matchingThumbJpeg(): Uint8Array {
  const main = photo(11).toBuffer('image/jpeg', 90);
  const t = createCanvas(160, 120);
  t.getContext('2d').drawImage(photo(11), 0, 0, 160, 120);
  const exif = {
    '0th': { [piexif.ImageIFD.Make]: 'FictionalCam' },
    '1st': { [piexif.ImageIFD.Compression]: 6 },
    thumbnail: toBinary(t.toBuffer('image/jpeg', 80)),
  };
  return fromBinary(piexif.insert(piexif.dump(exif), toBinary(main)));
}

/** JPEG with GPS, camera serial, owner, software, dates and a thumbnail that shows something else. */
export function gpsJpeg(): Uint8Array {
  const main = photo(3).toBuffer('image/jpeg', 90);
  // The thumbnail still shows the "uncropped original": different content.
  // (wider than the cropped main image, with different content).
  const thumb = photo(99, 160, 90, 'x').toBuffer('image/jpeg', 80);
  const { ImageIFD, ExifIFD, GPSIFD, GPSHelper } = piexif;
  const exif = {
    '0th': {
      [ImageIFD.Make]: 'FictionalCam',
      [ImageIFD.Model]: 'FC-100 (FAKE)',
      [ImageIFD.Software]: 'PhotoFixer 2.0 (FAKE)',
      [ImageIFD.Artist]: 'Jordan Example',
      [ImageIFD.DateTime]: '2026:01:15 09:30:00',
      [ImageIFD.ImageDescription]: 'Back garden, 12 Fictional Road',
    },
    Exif: {
      [ExifIFD.DateTimeOriginal]: '2026:01:15 09:29:58',
      [ExifIFD.BodySerialNumber]: 'FAKE-SN-000123',
      [ExifIFD.CameraOwnerName]: 'Jordan Example',
      [ExifIFD.LensModel]: 'Fictional 35mm',
    },
    GPS: {
      [GPSIFD.GPSLatitudeRef]: 'N',
      [GPSIFD.GPSLatitude]: GPSHelper.degToDmsRational(51.5007),
      [GPSIFD.GPSLongitudeRef]: 'W',
      [GPSIFD.GPSLongitude]: GPSHelper.degToDmsRational(0.1246),
      [GPSIFD.GPSAltitude]: [12, 1],
      [GPSIFD.GPSAltitudeRef]: 0,
    },
    '1st': { [ImageIFD.Compression]: 6 },
    thumbnail: toBinary(thumb),
  };
  return fromBinary(piexif.insert(piexif.dump(exif), toBinary(main)));
}

/** Adds PNG tEXt chunks right after IHDR. */
export function addPngText(png: Uint8Array, entries: Record<string, string>): Uint8Array {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(entries)) {
    const data = Buffer.concat([
      Buffer.from(k, 'latin1'),
      Buffer.from([0]),
      Buffer.from(v, 'latin1'),
    ]);
    const type = Buffer.from('tEXt', 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
    chunks.push(Buffer.concat([len, type, data, crc]));
  }
  const b = Buffer.from(png);
  return new Uint8Array(Buffer.concat([b.subarray(0, ihdrEnd), ...chunks, b.subarray(ihdrEnd)]));
}

export function pixelatedPng(): Uint8Array {
  const png = screenshot({ pixelateBlock: 6 }).toBuffer('image/png');
  return addPngText(png, { Author: 'Jordan Example', Software: 'ScreenGrab 3 (FAKE)' });
}

export function cleanPng(): Uint8Array {
  const c = screenshot();
  const ctx = c.getContext('2d');
  // A table with 1px grid lines and colour swatches: regular structure that is NOT pixelation.
  ctx.fillStyle = '#cccccc';
  for (let x = 0; x <= 480; x += 20) ctx.fillRect(x, 190, 1, 10);
  ctx.drawImage(photo(5, 100, 60), 370, 120);
  return c.toBuffer('image/png');
}
