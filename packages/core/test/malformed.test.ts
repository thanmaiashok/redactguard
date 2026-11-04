import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR, FIXTURES } from '../../../fixtures/generate.js';
import { ScanError, scanBytes } from '../src/index.js';

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Either a report or a ScanError. Anything else (crash, TypeError, hang) fails. */
async function scanSafely(bytes: Uint8Array) {
  try {
    const r = await scanBytes(bytes, 'fuzz.pdf');
    expect(Array.isArray(r.findings)).toBe(true);
    return 'ok';
  } catch (err) {
    expect(err).toBeInstanceOf(ScanError);
    return (err as ScanError).code;
  }
}

describe('malformed PDFs never crash', () => {
  it('garbage after a PDF header', async () => {
    const code = await scanSafely(new TextEncoder().encode('%PDF-1.7\n' + 'garbage '.repeat(50)));
    expect(['ok', 'MALFORMED']).toContain(code);
  });

  it('empty and header-only files', async () => {
    expect(await scanSafely(new Uint8Array())).toBe('UNSUPPORTED');
    expect(['ok', 'MALFORMED']).toContain(await scanSafely(new TextEncoder().encode('%PDF-')));
  });

  it('truncated fixtures', async () => {
    for (const name of Object.keys(FIXTURES)) {
      const full = readFileSync(path.join(FIXTURE_DIR, name));
      for (const frac of [0.1, 0.5, 0.9]) {
        await scanSafely(new Uint8Array(full.subarray(0, Math.floor(full.length * frac))));
      }
    }
  });

  it('random byte corruption (seeded)', async () => {
    const rand = mulberry32(1234);
    const names = Object.keys(FIXTURES);
    for (let i = 0; i < 40; i++) {
      const name = names[i % names.length]!;
      const bytes = new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
      const flips = 1 + Math.floor(rand() * 20);
      for (let k = 0; k < flips; k++)
        bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
      await scanSafely(bytes);
    }
  }, 120_000);
});
