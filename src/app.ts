import { readFile } from 'node:fs/promises';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { apiRoutes } from './api/routes.ts';
import { authRoutes, sessionMiddleware } from './auth/routes.ts';
import type { Config } from './config.ts';
import { get } from './db/database.ts';
import { mcpHandler } from './mcp/http.ts';
import { authorizationServerMetadata, protectedResourceMetadata } from './oauth/metadata.ts';
import { oauthRoutes } from './oauth/routes.ts';
import { messagePage } from './pages/layout.ts';
import { photoFile } from './plants/photos.ts';
import { uploadRoutes } from './plants/upload-routes.ts';
import type { AppEnv, Deps } from './types.ts';
import { isAppRoute, loadStaticFiles } from './web/static.ts';

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

function securityHeaders(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const apply = (headers: Headers) => {
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
      if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'same-origin');
      if (config.secureCookies) headers.set('Strict-Transport-Security', 'max-age=31536000');
      if (!headers.has('Content-Security-Policy') && (headers.get('Content-Type') ?? '').includes('text/html')) {
        headers.set('Content-Security-Policy', PAGE_CSP);
      }
    };
    try {
      apply(c.res.headers);
    } catch {
      c.res = new Response(c.res.body, c.res); // immutable headers (e.g. Response.redirect)
      apply(c.res.headers);
    }
  };
}

/** Access log without query strings (they can carry codes) nor upload tokens. */
function accessLog(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith('/assets/') || pathname === '/healthz') return;
    const shown = pathname.startsWith('/p/') ? '/p/…' : pathname;
    console.info(`${c.req.method} ${shown} ${c.res.status} ${Date.now() - started}ms`);
  };
}

export function createApp(deps: Deps): Hono<AppEnv> {
  const { config, db } = deps;
  const app = new Hono<AppEnv>();
  const files = loadStaticFiles(config.webDir);
  const openCors = cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'MCP-Protocol-Version',
      'Mcp-Method',
      'Mcp-Name',
      'Mcp-Session-Id',
    ],
    exposeHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
    maxAge: 86_400,
  });

  app.use('*', accessLog());
  app.use('*', securityHeaders(config));
  // Small bodies everywhere; photo routes set their own limit after their auth
  // checks, and /mcp is capped by the MCP SDK once the bearer token is verified.
  const smallBody = bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: 'too_large', message: 'Requête trop volumineuse.' }, 413),
  });
  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/mcp' || path.startsWith('/p/') || /^\/api\/plants\/\d+\/photos?$/.test(path)) return next();
    return smallBody(c, next);
  });

  app.get('/healthz', (c) => {
    get(db, 'SELECT 1 AS ok');
    return c.json({ ok: true });
  });

  // OAuth discovery for MCP clients (RFC 8414 / RFC 9728).
  app.use('/.well-known/*', openCors);
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(authorizationServerMetadata(config)));
  app.get('/.well-known/oauth-protected-resource', (c) => c.json(protectedResourceMetadata(config)));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(protectedResourceMetadata(config)));

  // MCP endpoint: bearer tokens only, never cookies.
  app.use('/mcp', openCors);
  const mcp = mcpHandler(deps);
  app.all('/mcp', (c) => mcp(c));

  // Not /oauth/register: browsers have no business registering clients (drive-by spam).
  for (const path of ['/oauth/token', '/oauth/revoke']) app.use(path, openCors);

  // Everything below knows the browser session.
  app.use('*', sessionMiddleware(deps));
  app.route('/oauth', oauthRoutes(deps));
  app.route('/auth', authRoutes(deps));
  app.route('/api', apiRoutes(deps));
  app.route('/p', uploadRoutes(deps));

  app.get('/photos/:file', async (c) => {
    if (!c.get('session')) return c.text('Connexion requise', 401);
    const file = photoFile(config.dataDir, c.req.param('file'));
    if (!file) return c.text('Introuvable', 404);
    try {
      const body = new Uint8Array(await readFile(file));
      return c.body(body, 200, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
    } catch {
      return c.text('Introuvable', 404);
    }
  });

  app.get('*', (c) => {
    const pathname = new URL(c.req.url).pathname;
    const file = files.get(pathname) ?? (isAppRoute(pathname) ? files.get('/index.html') : undefined);
    if (!file) {
      if (isAppRoute(pathname)) {
        return c.html(messagePage('Plantes', 'L’interface web n’est pas construite (npm run build).'), 503);
      }
      return c.text('Introuvable', 404);
    }
    const headers: Record<string, string> = { 'Content-Type': file.type, 'Cache-Control': file.cacheControl };
    if (pathname === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    return c.body(file.body, 200, headers);
  });

  app.notFound((c) => c.text('Introuvable', 404));
  app.onError((error, c) => {
    console.error('unhandled error:', error);
    return c.text('Erreur interne', 500);
  });
  return app;
}
