import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXTURES, FIXTURE_DIR } from '../../../fixtures/generate.js';
import { scanFile } from '../src/index.js';

const EXPECTED_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/expected',
);
const UPDATE = process.env.UPDATE_GOLDEN === '1';

describe('golden findings', () => {
  for (const name of Object.keys(FIXTURES)) {
    it(name, async () => {
      const report = await scanFile(path.join(FIXTURE_DIR, name));
      const actual = report.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        ...(f.page ? { page: f.page } : {}),
        evidence: f.evidence,
      }));
      const file = path.join(EXPECTED_DIR, `${name}.json`);
      if (UPDATE || (!existsSync(file) && !process.env.CI))
        writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
      expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')));
      expect(report.warnings).toEqual([]);
    });
  }
});
