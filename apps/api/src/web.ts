import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono, MiddlewareHandler } from 'hono';
import { ConfigError, type AppConfig } from '@localscout/core';

/**
 * The built web interface, served by the API.
 *
 * A deployment is one process and one origin: the API answers `/api/*` and
 * serves the Vite build for everything else. That is not a convenience — it is
 * what keeps the browser talking to a single origin, so the API's CORS rules
 * stay meaningful, the SSE stream needs no cross-origin negotiation, and the
 * deploy token's one sign-in covers the interface and the API alike.
 *
 * Locally none of this is used: `pnpm dev` runs Vite, and SERVE_WEB is off.
 */

/** A deployment that asked to serve the interface but built none is a bug. */
export function resolveWebDist(config: AppConfig): string | undefined {
  if (!config.app.serveWeb) return undefined;

  const dist = config.app.webDist ?? join(findRepoRoot(), 'apps', 'web', 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    throw new ConfigError(
      `SERVE_WEB is on but there is no web build at ${dist}.\n\nRun \`pnpm build\` first, point WEB_DIST at the build, or unset SERVE_WEB.`,
      [{ path: 'SERVE_WEB', message: `No index.html in ${dist}.` }],
    );
  }
  return dist;
}

/**
 * Where the repository root is, which is not the working directory.
 *
 * `pnpm dev` starts the API from `apps/api`, and a container may run it from
 * anywhere, so the walk goes up from this module's own directory and stops at
 * the workspace manifest rather than at `process.cwd()`.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not find the workspace root (pnpm-workspace.yaml) to locate the web build.',
  );
}

/**
 * Serve the build at `dist`, hashed assets cached forever and the document
 * never cached.
 *
 * Every handler here falls through with `next()` when the path is not a file,
 * so API routes registered later still match. The SPA fallback lives in the
 * app's notFound handler instead of a `*` route, because a wildcard route
 * registered here would shadow every route registered after it.
 */
export function registerWebStatic(app: Hono, dist: string): void {
  // Vite hashes asset filenames, so a given URL's bytes never change.
  app.use('/assets/*', async (c, next) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    await next();
  });
  app.use('/assets/*', serveStatic({ root: dist }));

  /*
   * Everything else — the document, the favicon, and the SPA fallback's
   * document — revalidates every time, so a deploy is picked up on the next
   * navigation. This runs before the catch-all server: a found hashed asset
   * short-circuits above and keeps its immutable header; anything that falls
   * through to here gets no-cache, and an /api answer is overwritten with
   * no-store by the app's own header middleware.
   */
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-cache');
    await next();
  });
  app.use('*', serveStatic({ root: dist }));
}

/**
 * The document, for the routes the SPA owns.
 *
 * `no-cache` rather than `no-store`: the browser may keep the document, but
 * must revalidate it every time, so a deploy is picked up on the next
 * navigation instead of when someone remembers to hard-refresh.
 */
export function indexDocument(dist: string): MiddlewareHandler {
  const serveIndex = serveStatic({ root: dist, path: 'index.html' });
  return async (c, next) => {
    c.header('Cache-Control', 'no-cache');
    return serveIndex(c, next);
  };
}
