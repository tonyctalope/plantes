import { createServer, type AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGoogleProvider } from '../src/auth/google.ts';
import { CHLOE, setup, STRANGER, TONY, type TestContext } from './helpers.ts';

// A fake Google: OIDC discovery, an /authorize that immediately redirects back
// with a code, a token endpoint returning an RS256-signed ID token, and JWKS.
// The app talks to it with the real openid-client.

const CLIENT_ID = 'google-client';

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

interface Pending {
  nonce: string;
  email: string;
  verified: boolean;
  challenge: string;
}

describe('Google sign-in (OIDC) and the e-mail allowlist', () => {
  let issuer: string;
  let server: ServerType;
  let nextIdentity = { email: TONY, verified: true };
  const codes = new Map<string, Pending>();

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const port = await freePort();
    issuer = `http://127.0.0.1:${port}`;
    const google = new Hono();
    google.get('/.well-known/openid-configuration', (c) =>
      c.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      }),
    );
    google.get('/jwks', (c) => c.json({ keys: [jwk] }));
    google.get('/authorize', (c) => {
      const q = c.req.query();
      const code = `code-${codes.size + 1}`;
      codes.set(code, { nonce: q.nonce!, challenge: q.code_challenge!, ...nextIdentity });
      return c.redirect(`${q.redirect_uri}?code=${code}&state=${encodeURIComponent(q.state!)}`, 302);
    });
    google.post('/token', async (c) => {
      const form = await c.req.parseBody();
      const pending = codes.get(String(form.code));
      codes.delete(String(form.code));
      if (!pending) return c.json({ error: 'invalid_grant' }, 400);
      const verifier = String(form.code_verifier);
      const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString(
        'base64url',
      );
      if (digest !== pending.challenge) return c.json({ error: 'invalid_grant', error_description: 'pkce' }, 400);
      const idToken = await new SignJWT({
        email: pending.email,
        email_verified: pending.verified,
        name: pending.email.split('@')[0],
        nonce: pending.nonce,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience(CLIENT_ID)
        .setSubject(`google-${pending.email}`)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return c.json({ access_token: 'google-at', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    });
    server = serve({ fetch: google.fetch, port, hostname: '127.0.0.1' });
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function app(): TestContext {
    const ctx = setup({ env: { GOOGLE_ISSUER: issuer } });
    // Routes read deps.identity per request, so swapping it in is enough.
    ctx.deps.identity = createGoogleProvider(ctx.deps.config, ctx.deps.db, { allowInsecure: true });
    return ctx;
  }

  /** Browser: start → (fake) Google → callback. Returns the final response. */
  async function signIn(ctx: TestContext, next = '/reglages', tamper?: (callback: URL) => void) {
    const start = await ctx.app.request(`/auth/google/start?next=${encodeURIComponent(next)}`);
    expect(start.status).toBe(302);
    const loginCookie = start.headers.get('set-cookie')!.split(';')[0]!;
    expect(loginCookie).toMatch(/^__Host-plantes_login=/);
    const atGoogle = new URL(start.headers.get('location')!);
    expect(atGoogle.origin).toBe(issuer);
    expect(atGoogle.searchParams.get('redirect_uri')).toBe('https://plantes.test/auth/google/callback');
    expect(atGoogle.searchParams.get('code_challenge_method')).toBe('S256');
    const back = await fetch(atGoogle, { redirect: 'manual' });
    const callback = new URL(back.headers.get('location')!);
    tamper?.(callback);
    return ctx.app.request(`${callback.pathname}${callback.search}`, { headers: { cookie: loginCookie } });
  }

  it('signs in an allowlisted, verified Google account', async () => {
    const ctx = app();
    nextIdentity = { email: TONY, verified: true };
    const done = await signIn(ctx);
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toBe('/reglages');
    const cookies = done.headers.getSetCookie();
    const sessionCookie = cookies.find((cookie) => cookie.startsWith('__Host-plantes_session='))!;
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(cookies.some((cookie) => cookie.startsWith('__Host-plantes_login=;'))).toBe(true); // one-shot login cookie cleared
    const session = sessionCookie.split(';')[0]!;
    const me = await ctx.app.request('/api/me', { headers: { cookie: session } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email: TONY } });
    ctx.cleanup();
  });

  it('refuses accounts outside the allowlist or with an unverified e-mail', async () => {
    const ctx = app();
    nextIdentity = { email: STRANGER, verified: true };
    const stranger = await signIn(ctx);
    expect(stranger.status).toBe(403);
    expect(await stranger.text()).toContain(STRANGER);
    expect(stranger.headers.getSetCookie().some((cookie) => cookie.includes('plantes_session='))).toBe(false);

    nextIdentity = { email: CHLOE, verified: false };
    const unverified = await signIn(ctx);
    expect(unverified.status).toBe(403);
    ctx.cleanup();
  });

  it('rejects a callback whose state does not match the browser and unsafe next paths', async () => {
    const ctx = app();
    nextIdentity = { email: TONY, verified: true };
    const forged = await signIn(ctx, '/', (callback) => callback.searchParams.set('state', 'forged'));
    expect(forged.status).toBe(400);

    const redirected = await signIn(ctx, '//evil.example/steal');
    expect(redirected.status).toBe(303);
    expect(redirected.headers.get('location')).toBe('/');
    ctx.cleanup();
  });
});
