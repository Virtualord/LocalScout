import { rmSync } from 'node:fs';
import { E2E_DATA_DIR } from '../playwright.config.js';

/**
 * Global setup.
 *
 * Deletes the throwaway database before the suite runs, so the API opens an
 * empty one on first boot.
 *
 * This step is load-bearing, not housekeeping. Discovery deduplicates against
 * every lead already stored, so a database left over from a previous run means
 * the search finds nothing new and the run that was supposed to exercise
 * auditing skips it silently. A suite that passes without testing anything is
 * worse than a suite that fails.
 *
 * The path is imported from the config rather than rebuilt here, because the two
 * have to agree: a setup file that wipes a different directory than the server
 * writes to is exactly the bug this replaced.
 */
export default function globalSetup(): void {
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
}
