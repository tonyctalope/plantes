import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientInformationContext,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { hiddenInputs, login, plantFields, sampleJpeg, setup, TONY, type TestContext } from './helpers.ts';

// End-to-end with the official MCP client SDK over real HTTP: discovery,
// registration (DCR or Client ID Metadata Document), browser consent, PKCE,
// RFC 9207 iss check, then the tools Claude uses.

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

class TestProvider implements OAuthClientProvider {
  private readonly creds = new Map<string, OAuthClientInformationMixed>();
  private stored?: OAuthTokens;
  private verifier?: string;
  private discovery?: OAuthDiscoveryState;
  lastState?: string;
  authorizationUrl?: URL;
  readonly redirectUrl = 'http://127.0.0.1:43123/callback';
  readonly clientMetadata: OAuthClientMetadata = {
    client_name: 'Vitest MCP client',
    redirect_uris: [this.redirectUrl],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'native',
  };
  readonly clientMetadataUrl?: string;
  constructor(clientMetadataUrl?: string) {
    if (clientMetadataUrl) this.clientMetadataUrl = clientMetadataUrl;
  }
  clientInformation(ctx?: OAuthClientInformationContext) {
    return ctx ? this.creds.get(ctx.issuer) : undefined;
  }
  saveClientInformation(info: OAuthClientInformationMixed, ctx?: OAuthClientInformationContext) {
    if (ctx) this.creds.set(ctx.issuer, info);
  }
  tokens() {
    return this.stored;
  }
  saveTokens(tokens: OAuthTokens) {
    this.stored = tokens;
  }
  state() {
    this.lastState = randomUUID();
    return this.lastState;
  }
  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.discovery = state;
  }
  discoveryState() {
    return this.discovery;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    if (!this.verifier) throw new Error('no verifier');
    return this.verifier;
  }
}

/** What the user's browser does: open the authorization URL, approve, follow the redirect. */
async function approveInBrowser(origin: string, authorizationUrl: URL, cookie: string): Promise<URLSearchParams> {
  const start = await fetch(authorizationUrl, { headers: { cookie }, redirect: 'manual' });
  expect(start.status).toBe(302);
  const consentUrl = new URL(start.headers.get('location')!, origin);
  const page = await fetch(consentUrl, { headers: { cookie } });
  const inputs = hiddenInputs(await page.text());
  const approved = await fetch(new URL('/oauth/consent', origin), {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...inputs, decision: 'allow' }),
    redirect: 'manual',
  });
  expect(approved.status).toBe(303);
  return new URL(approved.headers.get('location')!).searchParams;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const block = (result.content as { type: string; text?: string }[]).find((item) => item.type === 'text');
  return block?.text ?? '';
}

describe('MCP end to end', () => {
  let ctx: TestContext | undefined;
  let server: ServerType | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    ctx?.cleanup();
  });

  async function start(fetchImpl?: typeof fetch) {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    ctx = setup({ origin, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
    server = serve({ fetch: ctx.app.fetch, port, hostname: '127.0.0.1' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { origin, mcpUrl: new URL('/mcp', origin), ctx };
  }

  async function connect(
    mcpUrl: URL,
    origin: string,
    provider: TestProvider,
    options: ConstructorParameters<typeof Client>[1] = {},
  ) {
    const { cookie } = login(ctx!, TONY, 'Tony');
    const first = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
    await expect(new Client({ name: 'vitest', version: '1.0.0' }, options).connect(first)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(provider.authorizationUrl?.pathname).toBe('/oauth/authorize');
    const params = await approveInBrowser(origin, provider.authorizationUrl!, cookie);
    expect(params.get('state')).toBe(provider.lastState);
    expect(params.get('iss')).toBe(origin);
    await first.finishAuth(params);
    const client = new Client({ name: 'vitest', version: '1.0.0' }, options);
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider }));
    return client;
  }

  it('lets a 2025-era client register dynamically, authorize and use every tool', async () => {
    const { origin, mcpUrl } = await start();
    const client = await connect(mcpUrl, origin, new TestProvider());

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_plant',
      'archive_plant',
      'create_photo_upload_link',
      'get_due_plants',
      'get_plant',
      'list_plants',
      'log_care',
      'snooze_watering',
      'update_plant',
    ]);
    const addTool = tools.find((tool) => tool.name === 'add_plant')!;
    expect(JSON.stringify(addTool.inputSchema)).toContain('Reminder cadence in DAYS');

    const added = await client.callTool({
      name: 'add_plant',
      arguments: { ...plantFields(), last_watered: '2026-11-08' },
    });
    expect(added.isError).toBeFalsy();
    const addedText = textOf(added);
    expect(addedText).toContain('Added plant #1 "Monstera du salon"');
    const uploadUrl = /photo_upload_url: (\S+)/.exec(addedText)![1]!;
    expect(uploadUrl).toMatch(new RegExp(`^${origin}/p/[A-Za-z0-9_-]{43}$`));

    // What `curl -F photo=@plante.jpg <url>` does.
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(await sampleJpeg())], { type: 'image/jpeg' }), 'plante.jpg');
    const upload = await fetch(uploadUrl, { method: 'POST', body: form });
    expect(upload.status).toBe(200);
    expect(await upload.json()).toMatchObject({ ok: true, plant_id: 1 });

    const duplicate = await client.callTool({ name: 'add_plant', arguments: plantFields() });
    expect(duplicate.isError).toBe(true);

    const withPhoto = await client.callTool({ name: 'get_plant', arguments: { plant_id: 1, include_photo: true } });
    const image = (withPhoto.content as { type: string; mimeType?: string }[]).find((item) => item.type === 'image');
    expect(image?.mimeType).toBe('image/webp');
    const sheet = JSON.parse(textOf(withPhoto)) as {
      care_sheet: { light: string };
      recent_events: { type: string; by: string }[];
    };
    expect(sheet.care_sheet.light).toBe('bright_indirect');
    expect(sheet.recent_events[0]).toMatchObject({ type: 'water', by: 'Tony' });

    const listed = JSON.parse(textOf(await client.callTool({ name: 'list_plants', arguments: {} }))) as {
      rooms: string[];
      plants: { has_photo: boolean }[];
    };
    expect(listed.rooms).toEqual(['Salon']);
    expect(listed.plants[0]!.has_photo).toBe(true);

    const logged = await client.callTool({ name: 'log_care', arguments: { plant_ids: [1], note: 'Bien arrosée' } });
    expect(JSON.parse(textOf(logged))).toMatchObject({ recorded: 'water', plants: [{ last_watered_by: 'Tony' }] });
    const future = await client.callTool({ name: 'log_care', arguments: { plant_ids: [1], date: '2099-01-01' } });
    expect(future.isError).toBe(true);
    const unknown = await client.callTool({ name: 'log_care', arguments: { plant_ids: [42] } });
    expect(unknown.isError).toBe(true);

    const due = JSON.parse(
      textOf(await client.callTool({ name: 'get_due_plants', arguments: { within_days: 30 } })),
    ) as {
      count: number;
    };
    expect(due.count).toBe(1);

    const snoozed = await client.callTool({ name: 'snooze_watering', arguments: { plant_ids: [1], days: 3 } });
    expect(snoozed.isError).toBeFalsy();
    const updated = await client.callTool({
      name: 'update_plant',
      arguments: { plant_id: 1, room: 'Chambre', water_interval_rest: 14 },
    });
    expect(JSON.parse(textOf(updated))).toMatchObject({ plant: { room: 'Chambre' } });

    const invalid = await client.callTool({ name: 'add_plant', arguments: { nickname: 'Incomplète' } });
    expect(invalid.isError).toBe(true);

    await client.close();
  });

  it('serves a 2026-07-28 client that identifies with a Client ID Metadata Document', async () => {
    const docUrl = 'https://claude.ai/oauth/vitest-client.json';
    const provider = new TestProvider(docUrl);
    const { origin, mcpUrl } = await start(async (input) => {
      expect(String(input instanceof Request ? input.url : input)).toBe(docUrl);
      return Response.json({
        client_id: docUrl,
        client_name: 'Claude (test)',
        redirect_uris: [provider.redirectUrl],
        token_endpoint_auth_method: 'none',
      });
    });
    const client = await connect(mcpUrl, origin, provider, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    const listed = await client.callTool({ name: 'list_plants', arguments: {} });
    expect(JSON.parse(textOf(listed))).toMatchObject({ count: 0 });
    const grants = await ctx!.app.request('/api/connections', { headers: { cookie: login(ctx!, TONY).cookie } });
    expect(await grants.json()).toMatchObject({ connections: [{ clientName: 'Claude (test)' }] });
    await client.close();
  });
});
