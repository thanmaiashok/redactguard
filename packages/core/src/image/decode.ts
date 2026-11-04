/** Decoded RGBA pixels. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Skip pixel analysis above this size (megapixels) to keep scans fast and memory bounded. */
export const MAX_MEGAPIXELS = 40;

type Canvas = typeof import('@napi-rs/canvas');
let canvasPromise: Promise<Canvas | null> | undefined;

/** @napi-rs/canvas is loaded lazily; scans still work (without pixel checks) if it is missing. */
export function loadCanvas(): Promise<Canvas | null> {
  canvasPromise ??= import('@napi-rs/canvas').catch(() => null);
  return canvasPromise;
}

/** Decodes PNG / JPEG / WebP / GIF bytes. Returns null when the format can't be decoded here. */
export async function decodeImage(bytes: Uint8Array): Promise<Pixels | null> {
  const c = await loadCanvas();
  if (!c) return null;
  try {
    const img = await c.loadImage(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const { width, height } = img;
    if (!width || !height || (width * height) / 1e6 > MAX_MEGAPIXELS) return null;
    const canvas = c.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } catch {
    return null;
  }
}

/** Nearest-neighbour-free box downscale to (w, h), grayscale. Used to compare thumbnails. */
export function grayResize(p: Pixels, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const cnt = new Float32Array(w * h);
  for (let y = 0; y < p.height; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / p.height));
    for (let x = 0; x < p.width; x++) {
      const tx = Math.min(w - 1, Math.floor((x * w) / p.width));
      const i = (y * p.width + x) * 4;
      const g = 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]!;
      out[ty * w + tx]! += g;
      cnt[ty * w + tx]! += 1;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? out[i]! / cnt[i]! : 0;
  return out;
}

/** pdf.js image kinds. */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

/** Converts a decoded pdf.js image object to RGBA. */
export function pixelsFromPdfjs(obj: unknown): Pixels | null {
  const o = obj as { width?: number; height?: number; kind?: number; data?: Uint8Array } | null;
  if (!o || !o.width || !o.height || !o.data) return null;
  const { width, height, kind, data } = o;
  if ((width * height) / 1e6 > MAX_MEGAPIXELS) return null;
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === RGBA_32BPP && data.length >= width * height * 4) {
    out.set(data.subarray(0, width * height * 4));
  } else if (kind === RGB_24BPP && data.length >= width * height * 3) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = data[j]!;
      out[i * 4 + 1] = data[j + 1]!;
      out[i * 4 + 2] = data[j + 2]!;
      out[i * 4 + 3] = 255;
    }
  } else if (kind === GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3;
    if (data.length < rowBytes * height) return null;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const i = (y * width + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = v;
        out[i + 3] = 255;
      }
  } else {
    return null;
  }
  return { width, height, data: out };
}
