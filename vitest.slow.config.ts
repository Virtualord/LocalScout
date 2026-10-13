import { defineConfig } from 'vitest/config';

/**
 * The slow suite.
 *
 * `pnpm test:slow` runs these; `pnpm test` does not. The split exists because
 * the fast suite is what runs on every save and in CI, and a real Chrome launch
 * takes longer than everything else in this repository combined.
 *
 * The split is not "unit versus integration" in the abstract. It is a concrete,
 * checkable rule: a file needs this config when it requires a real browser, a
 * real socket or real wall-clock time, and it signals that by being named
 * `*.slow.test.ts`. The fast config excludes that pattern explicitly, so a slow
 * test cannot silently creep into the fast run.
 *
 * Nothing here needs a key, a model or an API credit. Chrome is optional: the
 * Lighthouse tests skip with a stated reason when it is missing.
 */
export default defineConfig({
  test: {
    include: ['**/*.slow.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/*.e2e.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // Chrome launches and Lighthouse runs are slow by nature, so the timeout has
    // to be generous or the suite is worthless.
    testTimeout: 180_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@localscout/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
});
