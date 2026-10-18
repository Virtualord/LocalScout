import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { AppRuntime } from './runtime.js';

/**
 * The deploy token.
 *
 * Local runs set no token and are untouched: the config loader only allows a
 * missing token while HOST stays loopback, so this middleware is inert on a
 * laptop and mandatory the moment the API is reachable from anywhere else.
 *
 * Two standard forms are accepted:
 *
 *   Authorization: Bearer <token>            scripts, curl
 *   Authorization: Basic <any-user>:<token>  a browser, which prompts once
 *
 * The Basic form exists for the browser. EventSource cannot set headers, and
 * the runs screen follows progress over SSE; a browser, however, attaches
 * credentials it already holds to every same-origin request, stream included.
 * So the whole interface sits behind one native prompt and no client code has
 * to carry the secret.
 */

/** The one route a platform's health checker must reach without credentials. */
const HEALTH_PATH = '/api/health';

export function registerDeployTokenAuth(app: Hono, runtime: AppRuntime): void {
  const token = runtime.config.auth.token;
  if (token === undefined) return;

  app.use('*', async (c, next) => {
    /*
     * Health is exempt because a platform health checker cannot sign in, and
     * the route was built to be secret-free: booleans about which keys are
     * set, the active modes, and the database path. OPTIONS is exempt because
     * CORS preflights never carry credentials by specification.
     */
    if (c.req.method === 'OPTIONS' || c.req.path === HEALTH_PATH) return next();

    if (authorized(c.req.header('authorization') ?? '', token)) return next();

    // The challenge is what makes a browser show its sign-in prompt.
    c.header('WWW-Authenticate', 'Basic realm="Localscout"');
    return c.json(
      {
        error:
          'This deployment is gated by its access token. Sign in with any username and the AUTH_TOKEN value as the password.',
      },
      401,
    );
  });
}

function authorized(header: string, token: string): boolean {
  const value = header.trim();

  if (value.startsWith('Bearer ')) {
    return tokensMatch(value.slice('Bearer '.length).trim(), token);
  }

  if (value.startsWith('Basic ')) {
    let decoded: string;
    try {
      decoded = Buffer.from(value.slice('Basic '.length).trim(), 'base64').toString('utf8');
    } catch {
      return false;
    }
    const separator = decoded.indexOf(':');
    if (separator === -1) return false;
    // The username is ignored: one shared secret, not a set of accounts.
    return tokensMatch(decoded.slice(separator + 1), token);
  }

  return false;
}

/**
 * Constant-time comparison.
 *
 * Both sides are hashed first so `timingSafeEqual` always receives equal-length
 * buffers; comparing lengths up front would itself leak the token's length.
 */
function tokensMatch(candidate: string, token: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}
