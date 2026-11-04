import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../fixtures/generate.js';
import { matchingThumbJpeg, photo, screenshot } from '../../../fixtures/images.js';
import { sniffImage, webpExif } from '../src/image/analyze.js';
import { decodeImage } from '../src/image/decode.js';
import { detectMosaic, pixelationRisk } from '../src/image/pixelation.js';
import { scanBytes, scanFile } from '../src/index.js';

const mosaicOf = async (bytes: Uint8Array) => detectMosaic((await decodeImage(bytes))!);

describe('image metadata', () => {
  it('GPS is high, shown as readable coordinates', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'gps.jpg'));
    const gps = r.findings.find((f) => f.rule === 'image.gps')!;
    expect(gps.severity).toBe('high');
    expect(gps.evidence).toBe(
      'EXIF/GPS: 51.50070, -0.12460 (51.5007° N, 0.1246° W), altitude 12 m',
    );
    expect(gps.title).toMatch(/where it was taken/);
  });

  it('camera serial, owner, device, software, dates, description', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'gps.jpg'));
    const by = (rule: string) => r.findings.find((f) => f.rule === rule);
    expect(by('image.camera-serial')!.evidence).toBe('EXIF/SerialNumber: FAKE-SN-000123');
    expect(by('image.author')!.evidence).toBe('EXIF/Artist, EXIF/OwnerName: Jordan Example');
    expect(by('image.device')!.severity).toBe('low');
    expect(by('image.software')!.evidence).toContain('PhotoFixer');
    // Dates stay as written in the file (no time-zone conversion).
    expect(by('image.dates')!.evidence).toContain('2026:01:15 09:29:58');
    expect(by('image.description')!.evidence).toContain('12 Fictional Road');
  });

  it('a thumbnail that differs from the image is high; a matching one is info', async () => {
    const bad = await scanFile(path.join(FIXTURE_DIR, 'gps.jpg'));
    expect(bad.findings.find((f) => f.rule === 'image.thumbnail-mismatch')?.severity).toBe('high');
    const ok = await scanBytes(matchingThumbJpeg(), 'ok.jpg');
    expect(ok.findings.map((f) => f.rule)).toContain('image.thumbnail');
    expect(ok.findings.map((f) => f.rule)).not.toContain('image.thumbnail-mismatch');
  });

  it('PNG text chunks (author, software) are reported', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'pixelated.png'));
    expect(r.findings.find((f) => f.rule === 'image.author')!.evidence).toBe(
      'PNG text/Author: Jordan Example',
    );
  });

  it('clean PNG has no findings', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'clean.png'));
    expect(r.kind).toBe('image');
    expect(r.findings).toEqual([]);
  });

  it('reads EXIF from a WebP EXIF chunk', () => {
    const tiff = Buffer.from('II*\0\x08\0\0\0\0\0', 'latin1');
    const chunk = Buffer.concat([Buffer.from('EXIF'), Buffer.from([tiff.length, 0, 0, 0]), tiff]);
    const riff = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
      chunk,
    ]);
    expect(sniffImage(new Uint8Array(riff))).toBe('webp');
    expect(Buffer.from(webpExif(new Uint8Array(riff))!).toString('latin1')).toBe(
      tiff.toString('latin1'),
    );
  });
});

describe('pixelation heuristic (flag only, no reconstruction)', () => {
  it.each([4, 6, 8, 10, 12])('finds a %ipx mosaic over text in a PNG', async (b) => {
    const regions = await mosaicOf(screenshot({ pixelateBlock: b }).toBuffer('image/png'));
    expect(regions).toHaveLength(1);
    expect(regions[0]!.block).toBe(b);
    // The mosaic was applied at x=120..336, y=72..102.
    expect(regions[0]!.x).toBeGreaterThanOrEqual(112);
    expect(regions[0]!.x + regions[0]!.width).toBeLessThanOrEqual(340);
  });

  it('survives light JPEG compression', async () => {
    const regions = await mosaicOf(screenshot({ pixelateBlock: 10 }).toBuffer('image/jpeg', 95));
    expect(regions.map((r) => r.block)).toEqual([10]);
  });

  it('no false positives: text, photos, grids, flat UI', async () => {
    expect(await mosaicOf(screenshot().toBuffer('image/png'))).toEqual([]);
    expect(await mosaicOf(photo(3).toBuffer('image/png'))).toEqual([]);
    expect(await mosaicOf(photo(4, 800, 600).toBuffer('image/jpeg', 85))).toEqual([]);
    const grid = createCanvas(300, 200);
    const g = grid.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 300, 200);
    g.fillStyle = '#999';
    for (let x = 0; x < 300; x += 20) g.fillRect(x, 0, 1, 200);
    for (let y = 0; y < 200; y += 20) g.fillRect(0, y, 300, 1);
    g.fillStyle = '#3b6fd8';
    g.fillRect(40, 40, 120, 60);
    expect(await mosaicOf(grid.toBuffer('image/png'))).toEqual([]);
  });

  it('risk: small blocks over a text-height strip are high, big blocks are lower', () => {
    expect(pixelationRisk({ x: 0, y: 0, width: 200, height: 24, block: 6 }).risk).toBe('high');
    expect(pixelationRisk({ x: 0, y: 0, width: 200, height: 24, block: 12 }).risk).toBe('medium');
    expect(pixelationRisk({ x: 0, y: 0, width: 200, height: 48, block: 40 }).risk).toBe('low');
    expect(pixelationRisk({ x: 0, y: 0, width: 300, height: 300, block: 6 }).risk).toBe('medium');
  });

  it('pixelation finding says to use a solid box and gives coordinates', async () => {
    const r = await scanFile(path.join(FIXTURE_DIR, 'pixelated.png'));
    const f = r.findings.find((x) => x.rule === 'image.pixelation')!;
    expect(f.severity).toBe('high');
    expect(f.title).toMatch(/solid box/);
    expect(f.details).toMatchObject({ block: 6, units: 'px' });
  });
});

describe('malformed images never crash', () => {
  it('truncated JPEG/PNG and junk after a magic number', async () => {
    const { readFileSync } = await import('node:fs');
    for (const name of ['gps.jpg', 'pixelated.png']) {
      const full = readFileSync(path.join(FIXTURE_DIR, name));
      for (const frac of [0.05, 0.3, 0.7]) {
        const r = await scanBytes(
          new Uint8Array(full.subarray(0, Math.floor(full.length * frac))),
          name,
        );
        expect(r.kind).toBe('image');
      }
    }
    const junk = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await scanBytes(junk, 'junk.jpg')).kind).toBe('image');
  });
});
