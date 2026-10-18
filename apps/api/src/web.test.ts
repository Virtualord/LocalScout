import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  createLogger,
  createRepositories,
  FixtureProvider,
  loadConfig,
  MIN_AUTH_TOKEN_LENGTH,
  openDb,
  runMigrations,
  type Db,
} from '@localscout/core';
import { createApp } from './app.js';
import { registerHealthRoutes } from './routes/health.js';
import { resolveWebDist } from './web.js';
import type { AppRuntime } from './runtime.js';

/**
 * The served web build.
 *
 * A deployment is one origin: `/api/*` is the API, every other path is either
 * a file from the Vite build or the document, so the SPA's client-side routes
 * survive a refresh. These tests exercise exactly that split against a real
 * dist directory, including the caching policy that has to differ between
 * hashed assets and the document.
 */

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const ASSET = 'console.log("built asset");';

describe('serving the web build', () => {
  let dist: string;
  let dir: string;
  let handle: Db;
  let url: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-web-'));
    dist = join(dir, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), ASSET);

    url = join(dir, 'test.db');
    runMigrations({ url });
    handle = openDb({ url });
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp(env: NodeJS.ProcessEnv = {}): ReturnType<typeof createApp> {
    const config = loadConfig({
      SERVE_WEB: 'true',
      WEB_DIST: dist,
      ...env,
    } as NodeJS.ProcessEnv);

    const runtime: AppRuntime = {
      config,
      db: handle,
      repos: createRepositories(handle),
      logger: createLogger({
        level: 'silent',
        destination: new Writable({ write: (_c, _e, cb) => cb() }),
      }),
      provider: new FixtureProvider(),
      sender: { name: 'Aditya', services: 'websites' },
      databaseUrl: url,
      reportDir: join(dir, 'reports'),
      webDist: resolveWebDist(config),
      close: () => handle.close(),
    };

    const app = createApp(runtime);
    registerHealthRoutes(app, runtime);
    return app;
  }

  const get = (
    app: ReturnType<typeof createApp>,
    path: string,
    headers: Record<string, string> = {},
  ) => app.fetch(new Request(`http://127.0.0.1${path}`, { headers }));

  it('serves the document at /, never cached', async () => {
    const response = await get(buildApp(), '/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves hashed assets as immutable', async () => {
    const response = await get(buildApp(), '/assets/app-abc123.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ASSET);
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('hands a client-side route the document, so a refresh still works', async () => {
    const response = await get(buildApp(), '/leads', { accept: 'text/html,application/xhtml+xml' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it('answers a missing file that is not a navigation with an honest 404', async () => {
    const app = buildApp();

    const asset = await get(app, '/logo.png', { accept: 'image/png' });
    expect(asset.status).toBe(404);

    const route = await get(app, '/api/nope', { accept: 'text/html' });
    expect(route.status).toBe(404);
    expect(((await route.json()) as { error: string }).error).toContain('No route');
  });

  it('keeps API routes reachable with the static handlers in place', async () => {
    const response = await get(buildApp(), '/api/health');
    expect(response.status).toBe(200);
  });

  it('puts the interface behind the deploy token too', async () => {
    const token = 'a'.repeat(MIN_AUTH_TOKEN_LENGTH);
    const app = buildApp({ AUTH_TOKEN: token });

    const anonymous = await get(app, '/', { accept: 'text/html' });
    expect(anonymous.status).toBe(401);

    const signedIn = await get(app, '/', {
      accept: 'text/html',
      authorization: `Bearer ${token}`,
    });
    expect(signedIn.status).toBe(200);
  });

  describe('resolveWebDist', () => {
    it('is off when SERVE_WEB is off, whatever the layout', () => {
      expect(resolveWebDist(loadConfig({} as NodeJS.ProcessEnv))).toBeUndefined();
    });

    it('refuses to boot when no build exists, and says how to make one', () => {
      const config = loadConfig({
        SERVE_WEB: 'true',
        WEB_DIST: join(dir, 'missing'),
      } as NodeJS.ProcessEnv);

      expect(() => resolveWebDist(config)).toThrow(ConfigError);
      expect(() => resolveWebDist(config)).toThrow(/pnpm build/);
    });

    it('honours an explicit dist path', () => {
      const config = loadConfig({
        SERVE_WEB: 'true',
        WEB_DIST: dist,
      } as NodeJS.ProcessEnv);

      expect(resolveWebDist(config)).toBe(dist);
    });
  });
});
