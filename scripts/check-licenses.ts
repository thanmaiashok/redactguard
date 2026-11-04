/**
 * Fails if any production dependency has a license outside the permissive allow-list.
 * Run: pnpm check-licenses
 */
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Zlib',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
]);

/** Evaluates a simple SPDX expression: OR = any side allowed, AND = both allowed. */
export function isAllowed(expr: string): boolean {
  const e = expr.trim().replace(/^\((.*)\)$/, '$1');
  if (/\bOR\b/.test(e)) return e.split(/\bOR\b/).some((p) => isAllowed(p));
  if (/\bAND\b/.test(e)) return e.split(/\bAND\b/).every((p) => isAllowed(p));
  return ALLOWED.has(e.trim());
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const raw = execFileSync(pnpm, ['licenses', 'list', '--json', '--prod'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const byLicense = JSON.parse(raw) as Record<string, { name: string; versions: string[] }[]>;
const bad: string[] = [];
let total = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const p of pkgs) {
    total++;
    if (!isAllowed(license)) bad.push(`${p.name}@${p.versions.join(',')}: ${license}`);
  }
}
if (bad.length) {
  console.error(`Disallowed licenses:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`All ${total} production dependencies use permissive licenses.`);
