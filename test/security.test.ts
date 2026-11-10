import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/db/database.ts';
import { rateLimitKey } from '../src/lib/http.ts';
import { createUploadLink, resolveUploadLink } from '../src/plants/photos.ts';
import { createPlant } from '../src/plants/store.ts';
import { allowlist } from '../src/types.ts';
import { hiddenInputs, login, plantFields, setup, TONY, type TestContext } from './helpers.ts';

// Regression tests for the findings of the security review.

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function connectClient(ctx: TestContext, cookie: string) {
  const reg = (await (
    await ctx.app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }),
    })
  ).json()) as { client_id: string };
  const { verifier, challenge } = pkce();
  const start = await ctx.app.request(
    `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' })}`,
    { headers: { cookie } },
  );
  const consent = start.headers.get('location')!;
  const inputs = hiddenInputs(await (await ctx.app.request(consent, { headers: { cookie } })).text());
  const done = await ctx.app.request('/oauth/consent', {
    method: 'POST',
    headers: { cookie, origin: ctx.deps.config.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...inputs, decision: 'allow' }).toString(),
  });
  const code = new URL(done.headers.get('location')!).searchParams.get('code')!;
  return { clientId: reg.client_id, code, verifier };
}

async function token(ctx: TestContext, body: Record<string, string>) {
  const response = await ctx.app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return { status: response.status, json: (await response.json()) as Record<string, string> };
}

describe('security hardening', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => ctx.cleanup());

  it('refuses large bodies before buffering them', async () => {
    const big = 'x'.repeat(300 * 1024);
    const tokenResponse = await ctx.app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(big.length) },
      body: big,
    });
    expect(tokenResponse.status).toBe(413);
    const register = await ctx.app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(big.length) },
      body: big,
    });
    expect(register.status).toBe(413);
    // Unknown upload link: rejected on the token alone.
    const upload = await ctx.app.request(`/p/${'a'.repeat(43)}`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'content-length': String(15 * 1024 * 1024) },
      body: new Uint8Array(1024),
    });
    expect(upload.status).toBe(404);
  });

  it('pins redirect URIs to the exact Claude callbacks and loopback', async () => {
    const register = (uri: string) =>
      ctx.app.request('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [uri], token_endpoint_auth_method: 'none' }),
      });
    expect((await register('https://claude.ai/attacker-controlled/page')).status).toBe(400);
    expect((await register('https://evil.claude.ai/api/mcp/auth_callback')).status).toBe(400);
    expect((await register(CALLBACK)).status).toBe(201);
    expect((await register('https://claude.com/api/mcp/auth_callback')).status).toBe(201);
    expect((await register('http://localhost:7777/cb')).status).toBe(201);
  });

  it('does not let browsers register clients cross-origin', async () => {
    const preflight = await ctx.app.request('/oauth/register', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    const tokenPreflight = await ctx.app.request('/oauth/token', {
      method: 'OPTIONS',
      headers: { origin: 'https://inspector.example', 'access-control-request-method': 'POST' },
    });
    expect(tokenPreflight.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('evicts never-used clients instead of locking registration when full', async () => {
    for (let i = 0; i < 500; i++) {
      run(
        ctx.deps.db,
        `INSERT INTO oauth_clients (client_id, kind, client_name, redirect_uris, token_endpoint_auth_method, registration, created_at)
         VALUES (:id, 'dcr', 'spam', '[]', 'none', '{}', :at)`,
        { id: `spam-${i}`, at: new Date(Date.now() - (500 - i) * 1000).toISOString() },
      );
    }
    const response = await ctx.app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }),
    });
    expect(response.status).toBe(201);
    const remaining = ctx.deps.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients WHERE kind = 'dcr'").get() as {
      n: number;
    };
    expect(remaining.n).toBe(500);
  });

  it('only keeps allowed redirect URIs from metadata documents and trusts exact hosts', async () => {
    const docs: Record<string, unknown> = {
      'https://claude.ai/oauth/mixed.json': {
        client_id: 'https://claude.ai/oauth/mixed.json',
        client_name: 'Mixed',
        redirect_uris: ['https://attacker.example/cb', CALLBACK],
      },
      'https://claude.ai/oauth/evil.json': {
        client_id: 'https://claude.ai/oauth/evil.json',
        redirect_uris: ['https://attacker.example/cb'],
      },
    };
    ctx.cleanup();
    ctx = setup({
      fetch: async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        return docs[url] ? Response.json(docs[url]) : new Response('nope', { status: 404 });
      },
    });
    const { challenge } = pkce();
    const authorize = (clientId: string, redirect: string) =>
      ctx.app.request(
        `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' })}`,
      );
    expect((await authorize('https://claude.ai/oauth/mixed.json', 'https://attacker.example/cb')).status).toBe(400);
    expect((await authorize('https://claude.ai/oauth/mixed.json', CALLBACK)).status).toBe(302);
    expect((await authorize('https://claude.ai/oauth/evil.json', 'https://attacker.example/cb')).status).toBe(400);
    expect((await authorize('https://docs.anthropic.com/client.json', CALLBACK)).status).toBe(400);
  });

  it('answers a replayed refresh token with the same successor, once rotated', async () => {
    const { cookie } = login(ctx, TONY);
    const { clientId, code, verifier } = await connectClient(ctx, cookie);
    const first = await token(ctx, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
    });
    const refresh = { grant_type: 'refresh_token', client_id: clientId, refresh_token: first.json.refresh_token! };
    const a = await token(ctx, refresh);
    const b = await token(ctx, refresh);
    const c = await token(ctx, refresh);
    expect(a.status).toBe(200);
    expect(b.json.refresh_token).toBe(a.json.refresh_token);
    expect(c.json.access_token).toBe(a.json.access_token);
  });

  it('accepts the bare origin as resource at the token endpoint too', async () => {
    const { cookie } = login(ctx, TONY);
    const { clientId, code, verifier } = await connectClient(ctx, cookie);
    const response = await token(ctx, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      resource: 'https://plantes.test',
    });
    expect(response.status).toBe(200);
  });

  it('rate-limits each MCP connection', async () => {
    const { cookie } = login(ctx, TONY);
    const { clientId, code, verifier } = await connectClient(ctx, cookie);
    const { json } = await token(ctx, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
    });
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      const response = await ctx.app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${json.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: i,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        }),
      });
      if (response.status === 429) limited++;
    }
    expect(limited).toBe(5);
  });

  it('kills upload links when their creator leaves the allowlist', () => {
    const { userId } = login(ctx, TONY);
    const plant = createPlant(ctx.deps.db, plantFields(), { userId, via: 'test' });
    const { token: link } = createUploadLink(ctx.deps.db, plant, userId);
    const isAllowed = allowlist(ctx.deps.config);
    expect(resolveUploadLink(ctx.deps.db, link, isAllowed)).not.toBeNull();
    (ctx.deps.config.allowedEmails as Set<string>).delete(TONY);
    expect(resolveUploadLink(ctx.deps.db, link, isAllowed)).toBeNull();
  });

  it('keeps at most three live upload links per plant', () => {
    const { userId } = login(ctx, TONY);
    const plant = createPlant(ctx.deps.db, plantFields(), { userId, via: 'test' });
    for (let i = 0; i < 6; i++) createUploadLink(ctx.deps.db, plant, userId);
    const count = ctx.deps.db
      .prepare('SELECT COUNT(*) AS n FROM photo_upload_tokens WHERE plant_id = ?')
      .get(plant) as { n: number };
    expect(count.n).toBe(3);
  });

  it('groups IPv6 clients by /64 for rate limiting', () => {
    expect(rateLimitKey('2001:db8:1:2:aaaa::1')).toBe(rateLimitKey('2001:db8:1:2:bbbb::2'));
    expect(rateLimitKey('2001:db8:1:3::1')).not.toBe(rateLimitKey('2001:db8:1:2::1'));
    expect(rateLimitKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });
});
