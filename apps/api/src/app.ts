import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import type { AppRuntime } from './runtime.js';

/**
 * The local API server.
 *
 * Bound to 127.0.0.1 only. This is not a network service: it exists so a browser
 * on the same machine can talk to the pipeline, and it should never be reachable
 * from another machine.
 *
 * CORS is restricted to the Vite dev origin, body sizes are capped, and a set of
 * conservative security headers is applied. No endpoint ever returns a secret.
 */

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function createApp(runtime: AppRuntime): Hono {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
      credentials: false,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type'],
      maxAge: 600,
    }),
  );

  // Conservative headers. This serves JSON and static assets to one browser on
  // localhost, so there is no reason to relax any of these.
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    // No remote origins at all: the app is entirely local, so any attempt to
    // load a script or font from elsewhere is either a mistake or an attack.
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://localhost:8787 http://127.0.0.1:8787 ws://localhost:5173 ws://127.0.0.1:5173; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    c.header('Cache-Control', 'no-store');
  });

  /*
   * A run search is a small JSON body; anything larger is a mistake or an
   * attempt to exhaust memory.
   *
   * Hono's middleware rather than a peek at `content-length`, which is what this
   * used to do. A request sent with `transfer-encoding: chunked` carries no
   * length header at all, so the header read as 0 and the body went through
   * unmeasured. This still trusts a declared length, but counts the bytes as
   * they arrive whenever there is no length to trust.
   */
  app.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: 'Request body is too large.' }, 413),
    }),
  );

  app.use('*', honoLogger());

  app.get('/', (c) =>
    c.json({
      name: 'Localscout API',
      note: 'Local API. The interface is on http://localhost:5173.',
    }),
  );

  // Routes are registered by the caller so this module stays free of imports
  // that would create a cycle with the workflow.
  app.notFound((c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}.` }, 404));

  app.onError((error, c) => {
    runtime.logger.error({ err: error, path: c.req.path }, 'api.unhandled_error');
    // The message is generic on purpose: an unhandled error may contain paths
    // or values the browser has no business seeing.
    return c.json({ error: 'Something went wrong handling that request.' }, 500);
  });

  return app;
}

export interface StartedServer {
  port: number;
  close(): Promise<void>;
}

export function startServer(runtime: AppRuntime, app: Hono): Promise<StartedServer> {
  const port = runtime.config.app.apiPort;

  return new Promise((resolve, reject) => {
    // 127.0.0.1 explicitly. Never 0.0.0.0: this service must not be reachable
    // from the network, and the default in some runtimes is every interface.
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });

    server.on('error', reject);
  });
}
