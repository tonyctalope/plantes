import { Hono, type MiddlewareHandler } from 'hono';
import { messagePage } from '../pages/layout.ts';
import { safeEqual } from '../lib/crypto.ts';
import { clientIp, isSameOrigin, RateLimiter, safeNextPath } from '../lib/http.ts';
import { allowlist, type AppEnv, type Deps } from '../types.ts';
import { clearAppCookie, readAppCookie, setAppCookie } from './cookies.ts';
import { LOGIN_COOKIE, LoginError } from './google.ts';
import { createSession, deleteSession, resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from './sessions.ts';
import { upsertUser } from './users.ts';

/** Loads the browser session (if any) into c.var.session. */
export function sessionMiddleware(deps: Deps): MiddlewareHandler<AppEnv> {
  const isAllowed = allowlist(deps.config);
  return async (c, next) => {
    const token = readAppCookie(c, deps.config, SESSION_COOKIE);
    c.set('session', token ? resolveSession(deps.db, token, isAllowed) : null);
    await next();
  };
}

export function authRoutes(deps: Deps): Hono<AppEnv> {
  const { config, db } = deps;
  const isAllowed = allowlist(config);
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter(30, 60_000);

  const signIn = (c: Parameters<MiddlewareHandler<AppEnv>>[0], user: { id: number }) => {
    const { token } = createSession(db, user.id, c.req.header('user-agent') ?? null);
    setAppCookie(c, config, SESSION_COOKIE, token, SESSION_TTL_MS / 1000);
  };

  app.get('/google/start', async (c) => {
    if (!limiter.take(clientIp(c))) return c.html(messagePage('Trop de tentatives', 'Réessaie dans une minute.'), 429);
    const next = safeNextPath(c.req.query('next'));
    if (config.devLogin) return c.redirect(`/auth/dev-login?next=${encodeURIComponent(next)}`, 302);
    try {
      const { url, state } = await deps.identity.start(next);
      setAppCookie(c, config, LOGIN_COOKIE, state, 600);
      return c.redirect(url, 302);
    } catch (error) {
      console.error('google login start failed:', (error as Error).message);
      return c.html(messagePage('Connexion indisponible', 'Google ne répond pas, réessaie dans un instant.'), 502);
    }
  });

  app.get('/google/callback', async (c) => {
    if (!limiter.take(clientIp(c))) return c.html(messagePage('Trop de tentatives', 'Réessaie dans une minute.'), 429);
    const retry = { href: '/auth/google/start', label: 'Réessayer' };
    const cookieState = readAppCookie(c, config, LOGIN_COOKIE);
    clearAppCookie(c, config, LOGIN_COOKIE);
    const query = c.req.query();
    if (query.error) {
      return c.html(messagePage('Connexion annulée', 'La connexion Google a été annulée.', retry), 400);
    }
    if (!query.state || !cookieState || !safeEqual(query.state, cookieState)) {
      return c.html(
        messagePage('Connexion expirée', 'Cette tentative de connexion n’est plus valide, recommence.', retry),
        400,
      );
    }
    // Rebuild the URL as Google saw it (we sit behind a TLS-terminating proxy).
    const callbackUrl = new URL(`/auth/google/callback${new URL(c.req.url).search}`, config.origin);
    let result;
    try {
      result = await deps.identity.finish(callbackUrl, query.state);
    } catch (error) {
      const message = error instanceof LoginError ? error.message : 'La réponse de Google n’a pas pu être vérifiée.';
      console.warn('google login failed:', (error as Error).message);
      return c.html(messagePage('Connexion impossible', message, retry), 400);
    }
    const { identity, nextPath } = result;
    if (!identity.emailVerified || !isAllowed(identity.email)) {
      console.warn(`login refused for ${identity.email} (verified=${identity.emailVerified})`);
      return c.html(
        messagePage(
          'Accès réservé',
          `L’adresse ${identity.email} n’est pas autorisée sur cette appli. Demande à l’administrateur de l’ajouter, ou connecte-toi avec un autre compte Google.`,
          { href: '/auth/google/start', label: 'Choisir un autre compte' },
        ),
        403,
      );
    }
    const user = upsertUser(db, { sub: identity.sub, email: identity.email, name: identity.name });
    signIn(c, user);
    console.info(`login: ${user.email}`);
    return c.redirect(safeNextPath(nextPath), 303);
  });

  app.post('/logout', (c) => {
    if (!isSameOrigin(c, config.origin)) return c.json({ error: 'forbidden', message: 'Origine inattendue.' }, 403);
    const session = c.get('session');
    if (session) deleteSession(db, session.idHash);
    clearAppCookie(c, config, SESSION_COOKIE);
    return c.body(null, 204);
  });

  if (config.devLogin) {
    // Local development without Google (refused by loadConfig outside localhost + NODE_ENV=development).
    app.get('/dev-login', (c) => {
      const email = c.req.query('email')?.toLowerCase();
      const next = safeNextPath(c.req.query('next'));
      if (!email) {
        const links = [...config.allowedEmails]
          .map(
            (address) =>
              `<li><a href="/auth/dev-login?email=${encodeURIComponent(address)}&next=${encodeURIComponent(next)}">${address}</a></li>`,
          )
          .join('');
        return c.html(
          `<!doctype html><meta charset="utf-8"><title>Dev login</title><h1>Dev login</h1><ul>${links}</ul>`,
        );
      }
      if (!isAllowed(email)) return c.text('not allowlisted', 403);
      signIn(c, upsertUser(db, { sub: null, email, name: email.split('@')[0]! }));
      return c.redirect(next, 303);
    });
  }

  return app;
}
