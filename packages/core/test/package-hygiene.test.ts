import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(n) ? [p] : [];
  });
}

describe('package hygiene', () => {
  it('every package imports only what it declares in its own dependencies', () => {
    const problems: string[] = [];
    for (const pkg of readdirSync(path.join(ROOT, 'packages'))) {
      const dir = path.join(ROOT, 'packages', pkg);
      const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      const deps = new Set(Object.keys(manifest.dependencies ?? {}));
      for (const f of files(path.join(dir, 'src'))) {
        const code = readFileSync(f, 'utf8');
        for (const m of code.matchAll(/(?:from|import\()\s*['"]([^'"./][^'"]*)['"]/g)) {
          const spec = m[1]!;
          if (spec.startsWith('node:') || builtinModules.includes(spec)) continue;
          const name = spec.startsWith('@')
            ? spec.split('/').slice(0, 2).join('/')
            : spec.split('/')[0]!;
          // Type-only imports of a declared package's subpaths are fine; undeclared packages are not.
          if (!deps.has(name))
            problems.push(
              `${path.relative(ROOT, f)} imports "${spec}" but ${pkg} does not depend on ${name}`,
            );
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
