import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

/**
 * A test HTTP server serving local fixture sites.
 *
 * These stand in for the small-business websites an audit actually visits. Each
 * one isolates a single failure mode so an audit result can be attributed to a
 * known cause rather than to whatever a live site happened to do that day.
 *
 * The server binds to 127.0.0.1 and exists only for tests. Audits of these
 * fixtures use an injected resolver so the SSRF guard's normal refusal of
 * loopback does not block the test.
 */

export interface FixtureSite {
  path: string;
  description: string;
  html: string;
  /** Status the route answers with. */
  status?: number;
  /** Delay before responding, for the timeout test. */
  delayMs?: number;
  /** Send this instead of HTML, to exercise a non-HTML response. */
  contentType?: string;
}

const page = (title: string, body: string, head = ''): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    ${head}
    <title>${title}</title>
  </head>
  <body>${body}</body>
</html>`;

const metaDescription = (text: string) => `<meta name="description" content="${text}" />`;
const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1" />';

/** A healthy small-business site: https-ready, mobile viewport, contact links. */
export const GOOD_SITE = page(
  'Sharma Plumbing Works | Emergency Plumbers in Bhopal',
  `<header><h1>Sharma Plumbing Works</h1></header>
   <main>
     <p>Emergency plumbing in MP Nagar, Bhopal since 2009.</p>
     <a href="tel:+919812345678">Call now</a>
     <a href="https://wa.me/919812345678">WhatsApp</a>
     <a href="mailto:hello@sharmaplumbing.in">Email us</a>
   </main>`,
  `${viewport}\n    ${metaDescription('Emergency plumbing services in Bhopal. Call 098123 45678 any time.')}`,
);

/** No viewport meta, so the site is not mobile ready. */
export const NO_VIEWPORT_SITE = page(
  'Verma Electricals',
  `<h1>Verma Electricals</h1><p>Wiring and repairs in Kolar Road.</p>
   <a href="tel:+919000012345">Call</a>`,
  metaDescription('Electrical repairs in Bhopal.'),
);

/** No meta description and a generic title. */
export const NO_META_SITE = page(
  'Home',
  `<h1>Welcome</h1><p>Tap to talk.</p>
   <a href="tel:+919000012345">Call</a>`,
  viewport,
);

/** No contact links at all: no tel, no WhatsApp, no mailto. */
export const NO_CONTACT_SITE = page(
  'Gupta Interiors | Interior Designers Bhopal',
  `<h1>Gupta Interiors</h1><p>Interior design services.</p>`,
  `${viewport}\n    ${metaDescription('Interior designers in New Market, Bhopal.')}`,
);

/** Every check passes. Used as the control in audit tests. */
export const CONTROL_SITE = GOOD_SITE;

export const FIXTURE_SITES: FixtureSite[] = [
  { path: '/good', description: 'All checks pass', html: GOOD_SITE },
  {
    path: '/no-viewport',
    description: 'Missing the viewport meta tag',
    html: NO_VIEWPORT_SITE,
  },
  {
    path: '/no-meta',
    description: 'Missing the meta description, generic title',
    html: NO_META_SITE,
  },
  {
    path: '/no-contact',
    description: 'No tel, WhatsApp or mailto link',
    html: NO_CONTACT_SITE,
  },
  {
    path: '/not-found',
    description: 'Answers 404',
    html: page('Not found', '<h1>404</h1>'),
    status: 404,
  },
  {
    path: '/server-error',
    description: 'Answers 500',
    html: page('Error', '<h1>500</h1>'),
    status: 500,
  },
  {
    path: '/slow',
    description: 'Responds slowly enough to exceed a short timeout',
    html: GOOD_SITE,
    delayMs: 3000,
  },
  {
    path: '/not-html',
    description: 'Answers with a PDF rather than HTML',
    html: '%PDF-1.4 fake pdf body',
    contentType: 'application/pdf',
  },
  {
    path: '/redirect-to-private',
    description: '302 to the cloud metadata address',
    html: '',
    status: 302,
  },
];

/** An HTML page that links to every other fixture, for the integration test. */
export const INDEX_SITE = page(
  'Localscout fixture sites',
  `<h1>Localscout fixture sites</h1>
   <ul>${FIXTURE_SITES.filter((s) => s.path !== '/redirect-to-private')
     .map((s) => `<li><a href="${s.path}">${s.description}</a></li>`)
     .join('')}</ul>`,
  viewport,
);

export interface FixtureServer {
  origin: string;
  url(path: string): string;
  close(): Promise<void>;
  server: Server;
}

export async function startFixtureServer(
  sites: FixtureSite[] = FIXTURE_SITES,
  options: { index?: string } = {},
): Promise<FixtureServer> {
  const routes = new Map(sites.map((site) => [site.path, site]));

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path === '/' && options.index !== undefined) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(options.index);
      return;
    }

    const site = routes.get(path);

    if (!site) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1>');
      return;
    }

    // A redirect aimed at the metadata service, used to prove the guard
    // re-checks every hop.
    if (site.path === '/redirect-to-private') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }

    const send = () => {
      res.writeHead(site.status ?? 200, {
        'content-type': site.contentType ?? 'text/html; charset=utf-8',
      });
      res.end(site.html);
    };

    if (site.delayMs && site.delayMs > 0) {
      setTimeout(send, site.delayMs);
      return;
    }

    send();
  });

  // Port 0 asks the OS for a free port, so parallel test runs never collide.
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fixture server did not bind to a port.');
  }

  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    server,
    url: (path: string) => `${origin}${path}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
