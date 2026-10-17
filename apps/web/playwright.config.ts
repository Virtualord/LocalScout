import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end configuration.
 *
 * Boots the real API and the real Vite dev server, because the point of an
 * e2e test here is the seam between them: the Vite proxy, the SSE stream, the
 * JSON shapes the typed client declares and the API actually returns. Mocking
 * that away would leave exactly the bugs this suite exists to catch.
 *
 * The API runs against a throwaway database in the system temp directory, so a
 * run never touches the developer's real leads and never leaves state behind in
 * the repository. The path is absolute on purpose: a relative `DATA_DIR`
 * resolves against whichever directory the API's `dev` script happens to run
 * from, which is not where this file lives, and a database written somewhere
 * nobody looks is a database that quietly survives between runs.
 */

const API_PORT = Number(process.env['E2E_API_PORT'] ?? 8788);
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 5174);

/** Absolute, unique per run, and removed by the global setup. */
export const E2E_DATA_DIR = join(tmpdir(), 'localscout-e2e-data');

/**
 * Where visual-state screenshots are written.
 *
 * Derived from this file's own location rather than from `config.rootDir`,
 * because Playwright resolves `rootDir` relative to the test directory and the
 * two disagree. CI uploads `apps/web/test-results/screenshots`, and a path that
 * drifts from that upload silently drops every screenshot on the floor.
 */
export const E2E_SCREENSHOT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'test-results',
  'screenshots',
);

export default defineConfig({
  testDir: './e2e',
  // Screenshots on failure and always, so a red run has evidence attached.
  outputDir: 'test-results/artifacts',
  fullyParallel: false,
  /*
   * One worker, deliberately.
   *
   * `fullyParallel: false` stops tests inside one file from overlapping, but
   * Playwright still runs files concurrently, and every test here talks to the
   * same API and the same SQLite database. Two workers both submitting
   * "plumber in Bhopal" means one of them is refused by the duplicate-run guard
   * with a 409, and the suite then fails on a race it created itself.
   *
   * This also matches what the app is: one person, one database, one run at a
   * time. Serialising costs about a minute and removes a whole class of
   * intermittent failure that would otherwise cost hours of debugging.
   */
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Axe runs on every route at two viewports, which is not instant.
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'test-results/report', open: 'never' }]]
    : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // One viewport per project; the suite is explicit about which.
    actionTimeout: 10_000,
  },

  globalSetup: './e2e/global-setup.ts',

  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile-390',
      // A real touch device profile, so `hover: none` and the coarse pointer
      // are exercised rather than simulated at a narrow width.
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],

  /*
   * Never reuse an existing server.
   *
   * Reusing is the obvious-looking optimisation and it is a trap. A server left
   * over from a previous session keeps its own database and its own compiled
   * view of the code, so `DATA_DIR` from this config never applies, a fixed
   * defect stays fixed-in-name-only, and the suite reports a green run against
   * something that is not what is in the working tree. A slower honest suite
   * beats a fast one that can quietly be testing the wrong code.
   */
  webServer: [
    {
      command: 'pnpm --filter @localscout/api dev',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        API_PORT: String(API_PORT),
        DATA_DIR: E2E_DATA_DIR,
        // No key and no model: fixtures answer both discovery and drafting, so
        // the suite needs neither an account nor a download. Chrome is *not*
        // forced out of the picture — where it is installed, the audits can carry
        // real Lighthouse metrics, which is what puts the flow test's
        // draft-already-exists branch within reach on a normal machine, while the
        // write-a-draft branch covers the runs where the sites could not be
        // reached.
        DISCOVERY_MODE: 'fixtures',
        LLM_PROVIDER: 'fixture',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @localscout/web dev --port ' + WEB_PORT,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
