import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hiddenInputs, login, setup, TONY, type TestContext } from './helpers.ts';

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function register(ctx: TestContext, body: Record<string, unknown>) {
  return ctx.app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Runs /authorize → consent → code for a logged-in user; returns the redirect URL. */
async function authorize(
  ctx: TestContext,
  cookie: string,
  params: Record<string, string>,
  decision: 'allow' | 'deny' = 'allow',
): Promise<URL> {
  const start = await ctx.app.request(`/oauth/authorize?${new URLSearchParams(params)}`, { headers: { cookie } });
  expect(start.status).toBe(302);
  const consentPath = start.headers.get('location')!;
  expect(consentPath).toMatch(/^\/oauth\/consent\?request=/);
  const page = await ctx.app.request(consentPath, { headers: { cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const inputs = hiddenInputs(html);
  const done = await ctx.app.request('/oauth/consent', {
    method: 'POST',
    headers: { cookie, origin: ctx.deps.config.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...inputs, decision }).toString(),
  });
  expect(done.status).toBe(303);
  return new URL(done.headers.get('location')!);
}

async function token(ctx: TestContext, body: Record<string, string>, headers: Record<string, string> = {}) {
  const response = await ctx.app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
  return { status: response.status, json: (await response.json()) as Record<string, string> };
}

describe('OAuth authorization server', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => ctx.cleanup());

  it('publishes RFC 8414 and RFC 9728 metadata', async () => {
    const as = await (await ctx.app.request('/.well-known/oauth-authorization-server')).json();
    expect(as).toMatchObject({
      issuer: 'https://plantes.test',
      authorization_endpoint: 'https://plantes.test/oauth/authorize',
      token_endpoint: 'https://plantes.test/oauth/token',
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    const prm = await (await ctx.app.request('/.well-known/oauth-protected-resource/mcp')).json();
    expect(prm).toMatchObject({
      resource: 'https://plantes.test/mcp',
      authorization_servers: ['https://plantes.test'],
    });
  });

  it('challenges unauthenticated MCP requests with the resource metadata URL', async () => {
    const response = await ctx.app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://plantes.test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('only registers clients that redirect to Claude or loopback', async () => {
    const evil = await register(ctx, {
      redirect_uris: ['https://evil.example/callback'],
      token_endpoint_auth_method: 'none',
    });
    expect(evil.status).toBe(400);
    expect(await evil.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    const scheme = await register(ctx, { redirect_uris: ['cursor://callback'] });
    expect(scheme.status).toBe(400);
    const plainHttp = await register(ctx, { redirect_uris: ['http://claude.ai/callback'] });
    expect(plainHttp.status).toBe(400);
    const ok = await register(ctx, { redirect_uris: [CLAUDE_CALLBACK], client_name: 'Claude' });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.client_id).toMatch(/^plt_client_/);
    // RFC 7591 default auth method is client_secret_basic → a secret is issued.
    expect(body.client_secret).toBeTypeOf('string');
    const local = await register(ctx, {
      redirect_uris: ['http://localhost:33418/callback'],
      token_endpoint_auth_method: 'none',
    });
    expect(local.status).toBe(201);
    expect((await local.json()) as Record<string, unknown>).not.toHaveProperty('client_secret');
  });

  it('runs the full authorization-code flow with PKCE, rotation and revocation', async () => {
    const reg = (await (
      await register(ctx, { redirect_uris: [CLAUDE_CALLBACK], client_name: 'Claude' })
    ).json()) as Record<string, string>;
    const basic = `Basic ${Buffer.from(`${reg.client_id}:${reg.client_secret}`).toString('base64')}`;
    const { cookie } = login(ctx, TONY);
    const { verifier, challenge } = pkce();
    const back = await authorize(ctx, cookie, {
      response_type: 'code',
      client_id: reg.client_id!,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: 'https://plantes.test/mcp',
      scope: 'plantes',
    });
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe('https://plantes.test');
    const code = back.searchParams.get('code')!;

    // Wrong verifier and wrong client secret are refused.
    expect(
      (
        await token(
          ctx,
          { grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK, code_verifier: pkce().verifier },
          { authorization: basic },
        )
      ).json.error,
    ).toBe('invalid_grant');
    const badSecret = `Basic ${Buffer.from(`${reg.client_id}:nope`).toString('base64')}`;
    expect(
      (
        await token(
          ctx,
          { grant_type: 'authorization_code', code, code_verifier: verifier },
          { authorization: badSecret },
        )
      ).status,
    ).toBe(401);

    // A failed attempt above already consumed nothing: PKCE failures don't burn the code.
    const ok = await token(
      ctx,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: CLAUDE_CALLBACK,
        code_verifier: verifier,
        resource: 'https://plantes.test/mcp',
      },
      { authorization: basic },
    );
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ token_type: 'Bearer', scope: 'plantes' });
    expect(ok.json.access_token).toMatch(/^plt_at_/);

    // Replaying the code fails and kills the tokens it produced.
    const replay = await token(
      ctx,
      { grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK, code_verifier: verifier },
      { authorization: basic },
    );
    expect(replay.json.error).toBe('invalid_grant');
    const afterReplay = await token(
      ctx,
      { grant_type: 'refresh_token', refresh_token: ok.json.refresh_token! },
      { authorization: basic },
    );
    expect(afterReplay.json.error).toBe('invalid_grant');
  });

  it('rotates refresh tokens and revokes the grant on late reuse', async () => {
    const reg = (await (
      await register(ctx, { redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' })
    ).json()) as Record<string, string>;
    const { cookie } = login(ctx, TONY);
    const { verifier, challenge } = pkce();
    // Loopback redirect: any port is accepted at request time (RFC 8252).
    const redirect = 'http://127.0.0.1:51234/callback';
    const back = await authorize(ctx, cookie, {
      response_type: 'code',
      client_id: reg.client_id!,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(back.host).toBe('127.0.0.1:51234');
    const first = await token(ctx, {
      grant_type: 'authorization_code',
      client_id: reg.client_id!,
      code: back.searchParams.get('code')!,
      redirect_uri: redirect,
      code_verifier: verifier,
    });
    expect(first.status).toBe(200);

    const second = await token(ctx, {
      grant_type: 'refresh_token',
      client_id: reg.client_id!,
      refresh_token: first.json.refresh_token!,
    });
    expect(second.status).toBe(200);
    expect(second.json.refresh_token).not.toBe(first.json.refresh_token);
    // Immediate reuse (retry/concurrency) is tolerated…
    const retry = await token(ctx, {
      grant_type: 'refresh_token',
      client_id: reg.client_id!,
      refresh_token: first.json.refresh_token!,
    });
    expect(retry.status).toBe(200);
    // …but a reuse after the grace period revokes everything.
    const realNow = Date.now;
    Date.now = () => realNow() + 5 * 60_000;
    try {
      const stolen = await token(ctx, {
        grant_type: 'refresh_token',
        client_id: reg.client_id!,
        refresh_token: first.json.refresh_token!,
      });
      expect(stolen.json.error).toBe('invalid_grant');
      const legit = await token(ctx, {
        grant_type: 'refresh_token',
        client_id: reg.client_id!,
        refresh_token: second.json.refresh_token!,
      });
      expect(legit.json.error).toBe('invalid_grant');
    } finally {
      Date.now = realNow;
    }
  });

  it('refuses bad authorization requests without redirecting to unknown URIs', async () => {
    const reg = (await (
      await register(ctx, { redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'none' })
    ).json()) as Record<string, string>;
    const { cookie } = login(ctx, TONY);
    const base = {
      response_type: 'code',
      client_id: reg.client_id!,
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
    };
    // Unregistered redirect URI → error page, no redirect.
    const wrongRedirect = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...base, redirect_uri: 'https://claude.ai/elsewhere' })}`,
      { headers: { cookie } },
    );
    expect(wrongRedirect.status).toBe(400);
    // Unknown client → error page.
    const unknown = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...base, client_id: 'plt_client_nope' })}`,
    );
    expect(unknown.status).toBe(400);
    // Missing PKCE / plain PKCE → error sent back to the client with iss.
    const plain = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...base, code_challenge_method: 'plain' })}`,
    );
    expect(plain.status).toBe(302);
    const location = new URL(plain.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('iss')).toBe('https://plantes.test');
    // Foreign resource indicator.
    const foreign = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...base, resource: 'https://other.example/mcp' })}`,
    );
    expect(new URL(foreign.headers.get('location')!).searchParams.get('error')).toBe('invalid_target');
    // Not logged in → Google login first, coming back to the consent page.
    const anonymous = await ctx.app.request(`/oauth/authorize?${new URLSearchParams(base)}`);
    const consent = anonymous.headers.get('location')!;
    const toLogin = await ctx.app.request(consent);
    expect(toLogin.status).toBe(302);
    expect(toLogin.headers.get('location')).toMatch(/^\/auth\/google\/start\?next=%2Foauth%2Fconsent/);
  });

  it('protects the consent form against CSRF and session swapping', async () => {
    const reg = (await (
      await register(ctx, { redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'none' })
    ).json()) as Record<string, string>;
    const tony = login(ctx, TONY);
    const start = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id!, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`,
    );
    const consentPath = start.headers.get('location')!;
    const inputs = hiddenInputs(
      await (await ctx.app.request(consentPath, { headers: { cookie: tony.cookie } })).text(),
    );
    const post = (headers: Record<string, string>, body: Record<string, string>) =>
      ctx.app.request('/oauth/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(body).toString(),
      });
    expect((await post({ cookie: tony.cookie }, { ...inputs, decision: 'allow' })).status).toBe(403); // no Origin
    expect(
      (await post({ cookie: tony.cookie, origin: 'https://evil.example' }, { ...inputs, decision: 'allow' })).status,
    ).toBe(403);
    expect(
      (
        await post(
          { cookie: tony.cookie, origin: 'https://plantes.test' },
          { ...inputs, csrf: 'forged', decision: 'allow' },
        )
      ).status,
    ).toBe(403);
    // Another household member cannot complete a request opened in Tony's session.
    const chloe = login(ctx, 'chloe@example.org');
    expect(
      (
        await post(
          { cookie: chloe.cookie, origin: 'https://plantes.test' },
          { request: inputs.request!, csrf: chloe.csrf, decision: 'allow' },
        )
      ).status,
    ).toBe(400);
    // Deny sends access_denied back.
    const denied = await post({ cookie: tony.cookie, origin: 'https://plantes.test' }, { ...inputs, decision: 'deny' });
    expect(new URL(denied.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
  });

  it('accepts Client ID Metadata Documents only from trusted hosts', async () => {
    const docUrl = 'https://claude.ai/oauth/mcp-client.json';
    const fetched: string[] = [];
    ctx.cleanup();
    ctx = setup({
      fetch: async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        fetched.push(url);
        return Response.json(
          {
            client_id: docUrl,
            client_name: 'Claude',
            redirect_uris: [CLAUDE_CALLBACK],
            token_endpoint_auth_method: 'none',
          },
          { headers: { 'cache-control': 'max-age=600' } },
        );
      },
    });
    const { cookie } = login(ctx, TONY);
    const { verifier, challenge } = pkce();
    const back = await authorize(ctx, cookie, {
      response_type: 'code',
      client_id: docUrl,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const ok = await token(ctx, {
      grant_type: 'authorization_code',
      client_id: docUrl,
      code: back.searchParams.get('code')!,
      redirect_uri: CLAUDE_CALLBACK,
      code_verifier: verifier,
    });
    expect(ok.status).toBe(200);
    expect(fetched).toEqual([docUrl]); // cached afterwards

    const untrusted = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'https://evil.example/client.json', code_challenge: challenge, code_challenge_method: 'S256' })}`,
    );
    expect(untrusted.status).toBe(400);
    expect(fetched).toHaveLength(1); // never fetched
  });

  it('stops honouring tokens when the e-mail leaves the allowlist', async () => {
    const reg = (await (
      await register(ctx, { redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'none' })
    ).json()) as Record<string, string>;
    const { cookie } = login(ctx, TONY);
    const { verifier, challenge } = pkce();
    const back = await authorize(ctx, cookie, {
      response_type: 'code',
      client_id: reg.client_id!,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const ok = await token(ctx, {
      grant_type: 'authorization_code',
      client_id: reg.client_id!,
      code: back.searchParams.get('code')!,
      redirect_uri: CLAUDE_CALLBACK,
      code_verifier: verifier,
    });
    const call = (app: TestContext['app']) =>
      app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ok.json.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        }),
      });
    expect((await call(ctx.app)).status).toBe(200);
    (ctx.deps.config.allowedEmails as Set<string>).delete(TONY);
    expect((await call(ctx.app)).status).toBe(401);
    expect((await ctx.app.request('/api/me', { headers: { cookie } })).status).toBe(401);
  });
});
