import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boot, type BootOptions } from './runtime.js';

/**
 * Reading `.env` at boot.
 *
 * Every instruction this project gives about configuration — the README, the
 * settings screen, the health check's own advice, `MANUAL_STEPS.md` — says to put
 * the key in `.env`. Nothing read it. A user who followed the instructions
 * exactly filled in the key, restarted, and was told they had no key, with
 * nothing in the logs to explain why.
 *
 * These tests exercise the loader through `boot` rather than by exporting the
 * helper, because what matters is the behaviour a user gets, not the shape of the
 * function. `boot` opens a database and runs migrations, so each test gets its own
 * temporary directory and closes the runtime afterwards.
 */

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'localscout-env-'));
  created.push(dir);
  return dir;
}

/**
 * Boot with the discovery variables cleared from the ambient environment.
 *
 * `pnpm dev` on a machine that has followed the setup instructions exports
 * `DISCOVERY_MODE=live` into the shell, and a test that inherits it fails for a
 * reason that has nothing to do with the loader. Both variables are saved and
 * restored rather than left set, so one test cannot leak into the next.
 */
function withCleanDiscoveryEnv<T>(run: () => T): T {
  const saved = {
    key: process.env['SERPAPI_API_KEY'],
    mode: process.env['DISCOVERY_MODE'],
  };
  delete process.env['SERPAPI_API_KEY'];
  delete process.env['DISCOVERY_MODE'];
  try {
    return run();
  } finally {
    if (saved.key === undefined) delete process.env['SERPAPI_API_KEY'];
    else process.env['SERPAPI_API_KEY'] = saved.key;
    if (saved.mode === undefined) delete process.env['DISCOVERY_MODE'];
    else process.env['DISCOVERY_MODE'] = saved.mode;
  }
}

const quietDb = (): BootOptions => ({
  databaseUrl: join(tempDir(), 'test.db'),
  prettyLogs: false,
});

/** Boot with the key unset in the environment, so only the file can supply it. */
function bootReading(envFile: { path: string; contents: string }) {
  writeFileSync(envFile.path, envFile.contents);
  // Not needed by the loader, but a key file that anyone can read is a habit
  // worth not modelling in a test.
  chmodSync(envFile.path, 0o600);
  return boot(undefined, quietDb());
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('boot and .env', () => {
  it('takes a key from an env file rather than only the process environment', () => {
    // Written beside the module, which is where `resolveEnvFile` looks first.
    const path = join(import.meta.dirname, '.env');
    const runtime = withCleanDiscoveryEnv(() =>
      bootReading({
        path,
        contents: ['DISCOVERY_MODE=live', 'SERPAPI_API_KEY=from-a-file', ''].join('\n'),
      }),
    );

    try {
      expect(runtime.config.discovery.serpApiKey).toBe('from-a-file');
      expect(runtime.config.discovery.mode).toBe('live');
    } finally {
      runtime.close();
      rmSync(path, { force: true });
    }
  });

  it('leaves a variable that is already in the environment alone', () => {
    const path = join(import.meta.dirname, '.env');
    writeFileSync(path, 'SERPAPI_API_KEY=from-the-file\n');

    const runtime = withCleanDiscoveryEnv(() => {
      process.env['SERPAPI_API_KEY'] = 'from-the-environment';
      return boot(undefined, quietDb());
    });

    try {
      // An exported variable has to win, or `SERPAPI_API_KEY=... pnpm dev` and a
      // CI-injected secret would both be silently overridden by a file.
      expect(runtime.config.discovery.serpApiKey).toBe('from-the-environment');
    } finally {
      runtime.close();
      rmSync(path, { force: true });
    }
  });

  it('boots with no env file at all, because the app is built to run without keys', () => {
    // `skipEnvFile` rather than "no file exists": this repository may well have a
    // real `.env` on the developer's disk, and a test that depends on its absence
    // fails the moment someone follows the setup instructions. What is being
    // asserted is that nothing is required.
    const runtime = withCleanDiscoveryEnv(() => {
      // The default is `fixtures`, which is what "no keys at all" means here.
      return boot(undefined, { ...quietDb(), skipEnvFile: true });
    });

    try {
      expect(runtime.config.discovery.mode).toBe('fixtures');
      expect(runtime.config.discovery.serpApiKey).toBeUndefined();
    } finally {
      runtime.close();
    }
  });

  it('skips the file when the caller says so, so a test never reads a real one', () => {
    // This is the branch the rest of the suite relies on: a developer's real
    // `.env` sits at the repository root, and a test that read it would pick up
    // whatever key that machine happens to have.
    const runtime = withCleanDiscoveryEnv(() =>
      boot(undefined, { ...quietDb(), skipEnvFile: true }),
    );

    try {
      expect(runtime.config.discovery.serpApiKey).toBeUndefined();
    } finally {
      runtime.close();
    }
  });
});
