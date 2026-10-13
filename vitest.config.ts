import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Suites run across packages, so the glob covers core, api, web and eval.
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/*.e2e.ts'],
    environment: 'node',
    // Component suites opt into jsdom with a `@vitest-environment jsdom` docblock.
    setupFiles: ['./vitest.setup.ts'],
    // A failed run must not hang on a live handle (Ollama, Chrome, DB).
    teardownTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/index.ts', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      // Tests import `@localscout/core` by name and must hit the same source
      // files the apps do, rather than a stale build output.
      '@localscout/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
});
