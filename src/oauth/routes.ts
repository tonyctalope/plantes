import { Hono, type Context } from 'hono';
import { messagePage } from '../pages/layout.ts';
import { consentPage } from '../pages/oauth.ts';
import { isValidPkceChallenge, safeEqual } from '../lib/crypto.ts';
import { clientIp, isSameOrigin, RateLimiter } from '../lib/http.ts';
import { allowlist, type AppEnv, type Deps } from '../types.ts';
import { authenticateClient, findClient, isLoopbackRedirect, redirectMatches, registerClient } from './clients.ts';
import { OAuthFailure, SCOPE } from './errors.ts';
import {
  deletePendingRequest,
  exchangeCode,
  issueCode,
  loadPendingRequest,
  refreshTokens,
  revokeToken,
  savePendingRequest,
} from './tokens.ts';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function withParams(uri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  return url.href;
}

function parseBasic(header: string | undefined): { id: string; secret: string } | null {
  const match = header ? /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header) : null;
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  try {
    return {
      id: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')),
      secret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' ')),
    };
  } catch {
    return null;
  }
}

async function formBody(c: Context): Promise<Record<string, string>> {
  const type = c.req.header('content-type') ?? '';
  const result: Record<string, string> = {};
  if (type.includes('application/json')) {
    const json = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [key, value] of Object.entries(json)) if (typeof value === 'string') result[key] = value;
    return result;
  }
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  for (const [key, value] of Object.entries(form)) if (typeof value === 'string') result[key] = value;
  return result;
}

function oauthError(c: Context, error: OAuthFailure, basicAuth = false) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (error.status === 401 && basicAuth) headers['WWW-Authenticate'] = 'Basic realm="plantes"';
  return c.json(error.body(), error.status, headers);
}

function errorPage(c: Context, status: 400 | 401 | 403 | 429, title: string, message: string) {
  return c.html(messagePage(title, message), status);
}

/** The resource indicator must name our MCP endpoint (the bare origin is accepted as an alias). */
function acceptsResource(value: string, deps: Deps): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/$/, '');
    return url.origin === deps.config.origin && (path === '' || path === '/mcp') && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function oauthRoutes(deps: Deps): Hono<AppEnv> {
  const { db, config } = deps;
  const isAllowed = allowlist(config);
  const app = new Hono<AppEnv>();
  const registerLimiter = new RateLimiter(20, 3600_000);
  const tokenLimiter = new RateLimiter(120, 60_000);
  const authorizeLimiter = new RateLimiter(60, 60_000);

  app.post('/register', async (c) => {
    if (!registerLimiter.take(clientIp(c))) {
      return oauthError(c, new OAuthFailure('invalid_client_metadata', 'too many registrations, retry later', 429));
    }
    const body = await c.req.json().catch(() => null);
    try {
      return c.json(registerClient(db, config, body), 201, NO_STORE);
    } catch (error) {
      if (error instanceof OAuthFailure) return oauthError(c, error);
      throw error;
    }
  });

  app.get('/authorize', async (c) => {
    if (!authorizeLimiter.take(clientIp(c))) return errorPage(c, 429, 'Trop de demandes', 'Réessaie dans une minute.');
    const q = c.req.query();
    if (!q.client_id) return errorPage(c, 400, 'Demande invalide', 'Paramètre client_id manquant.');
    let client;
    try {
      client = await findClient(db, config, q.client_id, deps.fetch);
    } catch (error) {
      if (!(error instanceof OAuthFailure)) throw error;
      return errorPage(c, 400, 'Application inconnue', `Cette application n’est pas reconnue (${error.description}).`);
    }
    const provided = q.redirect_uri !== undefined;
    const redirectUri = provided ? q.redirect_uri! : client.redirectUris.length === 1 ? client.redirectUris[0]! : null;
    if (!redirectUri || !client.redirectUris.some((registered) => redirectMatches(registered, redirectUri))) {
      return errorPage(c, 400, 'Adresse de retour refusée', 'L’adresse de retour ne correspond pas à l’application.');
    }
    // From here on, errors are reported to the client through the redirect.
    const back = (error: string, description: string) =>
      c.redirect(
        withParams(redirectUri, { error, error_description: description, state: q.state, iss: config.issuer }),
        302,
      );
    if (q.response_type !== 'code') return back('unsupported_response_type', 'response_type must be code');
    if (!q.code_challenge || !isValidPkceChallenge(q.code_challenge) || q.code_challenge_method !== 'S256') {
      return back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    if (q.resource !== undefined && !acceptsResource(q.resource, deps)) {
      return back('invalid_target', `unknown resource, expected ${config.mcpResource}`);
    }
    if (q.state !== undefined && q.state.length > 2000) return back('invalid_request', 'state is too long');
    const requestId = savePendingRequest(db, {
      clientId: client.clientId,
      redirectUri,
      redirectUriProvided: provided,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      scope: SCOPE,
      resource: config.mcpResource,
    });
    return c.redirect(`/oauth/consent?request=${requestId}`, 302);
  });

  app.get('/consent', async (c) => {
    const requestId = c.req.query('request') ?? '';
    const session = c.get('session');
    const here = `/oauth/consent?request=${encodeURIComponent(requestId)}`;
    if (!session) return c.redirect(`/auth/google/start?next=${encodeURIComponent(here)}`, 302);
    const request = loadPendingRequest(db, requestId, session.idHash);
    if (!request) return errorPage(c, 400, 'Demande expirée', 'Relance la connexion depuis Claude.');
    let client;
    try {
      client = await findClient(db, config, request.clientId, deps.fetch);
    } catch {
      return errorPage(c, 400, 'Application inconnue', 'Relance la connexion depuis Claude.');
    }
    const target = new URL(request.redirectUri);
    const loopback = isLoopbackRedirect(target);
    c.header('Content-Security-Policy', consentCsp(target.origin));
    c.header('Cache-Control', 'no-store');
    return c.html(
      consentPage({
        clientName: client.clientName,
        verifiedHost: client.kind === 'cimd' ? new URL(client.clientId).hostname : null,
        redirect: loopback ? { kind: 'loopback', host: target.host } : { kind: 'web', host: target.hostname },
        email: session.user.email,
        requestId,
        csrfToken: session.csrfToken,
        switchAccountUrl: `/auth/google/start?next=${encodeURIComponent(here)}`,
      }),
    );
  });

  app.post('/consent', async (c) => {
    if (!isSameOrigin(c, config.origin)) return errorPage(c, 403, 'Requête refusée', 'Origine inattendue.');
    const session = c.get('session');
    if (!session)
      return errorPage(c, 401, 'Session expirée', 'Reconnecte-toi puis relance la connexion depuis Claude.');
    const form = await formBody(c);
    if (!form.csrf || !safeEqual(form.csrf, session.csrfToken)) {
      return errorPage(c, 403, 'Requête refusée', 'Jeton de sécurité invalide, recharge la page.');
    }
    const requestId = form.request ?? '';
    const request = loadPendingRequest(db, requestId, session.idHash);
    if (!request) return errorPage(c, 400, 'Demande expirée', 'Relance la connexion depuis Claude.');
    deletePendingRequest(db, requestId);
    const common = { state: request.state, iss: config.issuer };
    if (form.decision !== 'allow') {
      return c.redirect(
        withParams(request.redirectUri, {
          error: 'access_denied',
          error_description: 'The user denied access',
          ...common,
        }),
        303,
      );
    }
    const code = issueCode(db, request, session.user.id);
    console.info(`oauth: ${session.user.email} authorized client ${request.clientId}`);
    return c.redirect(withParams(request.redirectUri, { code, ...common }), 303);
  });

  app.post('/token', async (c) => {
    if (!tokenLimiter.take(clientIp(c))) {
      return oauthError(c, new OAuthFailure('invalid_request', 'too many requests, retry later', 429));
    }
    const body = await formBody(c);
    const basic = parseBasic(c.req.header('authorization'));
    try {
      const client = await authenticateClient(
        db,
        config,
        { basic, clientId: body.client_id, clientSecret: body.client_secret },
        deps.fetch,
      );
      const ttl = config.oauth;
      let outcome;
      if (body.grant_type === 'authorization_code') {
        if (!body.code) throw new OAuthFailure('invalid_request', 'code is required');
        outcome = exchangeCode(
          db,
          client,
          {
            code: body.code,
            redirectUri: body.redirect_uri,
            codeVerifier: body.code_verifier,
            resource: body.resource,
          },
          isAllowed,
          ttl,
        );
      } else if (body.grant_type === 'refresh_token') {
        if (!body.refresh_token) throw new OAuthFailure('invalid_request', 'refresh_token is required');
        outcome = refreshTokens(
          db,
          client,
          { refreshToken: body.refresh_token, scope: body.scope, resource: body.resource },
          isAllowed,
          ttl,
        );
      } else {
        throw new OAuthFailure('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
      }
      if (!outcome.ok) throw outcome.error;
      return c.json(outcome.tokens, 200, NO_STORE);
    } catch (error) {
      if (error instanceof OAuthFailure) return oauthError(c, error, basic !== null);
      throw error;
    }
  });

  app.post('/revoke', async (c) => {
    if (!tokenLimiter.take(clientIp(c))) {
      return oauthError(c, new OAuthFailure('invalid_request', 'too many requests, retry later', 429));
    }
    const body = await formBody(c);
    const basic = parseBasic(c.req.header('authorization'));
    try {
      const client = await authenticateClient(
        db,
        config,
        { basic, clientId: body.client_id, clientSecret: body.client_secret },
        deps.fetch,
      );
      if (!body.token) throw new OAuthFailure('invalid_request', 'token is required');
      revokeToken(db, client, body.token);
      return c.body(null, 200, NO_STORE);
    } catch (error) {
      if (error instanceof OAuthFailure) return oauthError(c, error, basic !== null);
      throw error;
    }
  });

  return app;
}

/** The consent form redirects to the client, so form-action must allow that origin (Chrome enforces it). */
function consentCsp(redirectOrigin: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self'",
    `form-action 'self' ${redirectOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}
