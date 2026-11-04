import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./fixtures/global-setup.ts'],
    testTimeout: 30_000,
  },
});
