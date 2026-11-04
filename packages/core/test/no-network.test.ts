import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../fixtures/generate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const FORBIDDEN_MODULES = [
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dns',
  'dgram',
  'undici',
  'node-fetch',
  'axios',
  'got',
  'ws',
];
const FORBIDDEN_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'navigator.sendBeacon',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe('no network, ever', () => {
  it('no source file imports a networking module or calls a network global', () => {
    const pkgs = path.join(ROOT, 'packages');
    const files = readdirSync(pkgs).flatMap((p) => {
      const src = path.join(pkgs, p, 'src');
      try {
        return sourceFiles(src);
      } catch {
        return [];
      }
    });
    expect(files.length).toBeGreaterThan(0);
    const modRe = new RegExp(
      `(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*|getBuiltinModule\\s*\\(\\s*)['"](?:node:)?(${FORBIDDEN_MODULES.join('|')})(?:/[^'"]*)?['"]`,
    );
    const globRe = new RegExp(
      `(?<![\\w.])(?<!async\\s+)(${FORBIDDEN_GLOBALS.map((g) => g.replace('.', '\\.')).join('|')})\\s*\\(`,
    );
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const m = modRe.exec(code) ?? globRe.exec(code);
      if (m) offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('scanning every fixture makes zero network attempts (sockets, DNS, fetch all trapped)', () => {
    const script = path.join(ROOT, 'packages/core/test/helpers/offline-run.ts');
    const out = execFileSync(process.execPath, ['--import', 'tsx', script, FIXTURE_DIR], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = JSON.parse(out) as { attempts: string[]; scanned: number };
    expect(result.scanned).toBe(readdirSync(FIXTURE_DIR).length);
    expect(result.attempts).toEqual([]);
  });
});
