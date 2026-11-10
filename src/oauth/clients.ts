import * as z from 'zod';
import type { Config } from '../config.ts';
import { get, run, type Db } from '../db/database.ts';
import { randomToken, safeEqual, sha256 } from '../lib/crypto.ts';
import { OAuthFailure, SCOPE } from './errors.ts';

// Client registration for MCP clients: Client ID Metadata Documents (the
// 2026-07-28 default, fetched only from trusted hosts) and Dynamic Client
// Registration (deprecated but still what many clients use), restricted to
// Claude's callback hosts and loopback redirects.

export type AuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

export interface OAuthClient {
  clientId: string;
  kind: 'dcr' | 'cimd';
  clientName: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  secretHash: string | null;
}

interface ClientRow {
  client_id: string;
  kind: 'dcr' | 'cimd';
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: AuthMethod;
  expires_at: string | null;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_DCR_CLIENTS = 500;

export function isLoopbackRedirect(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

function hostAllowed(hostname: string, hosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Returns an error message, or null when the redirect URI is acceptable. */
export function checkRedirectUri(raw: string, httpsHosts: readonly string[] | 'any'): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `redirect URI is not an absolute URL: ${raw}`;
  }
  if (url.hash || raw.includes('#')) return 'redirect URIs must not contain a fragment';
  if (url.username || url.password) return 'redirect URIs must not contain credentials';
  if (isLoopbackRedirect(url)) return null;
  if (url.protocol !== 'https:') return `redirect URI must use https or a loopback http address: ${raw}`;
  if (httpsHosts !== 'any' && !hostAllowed(url.hostname, httpsHosts)) {
    return `redirect host ${url.hostname} is not allowed on this server`;
  }
  return null;
}

/** Exact match, except that loopback redirects may use any port (RFC 8252 §7.3). */
export function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(requested);
  } catch {
    return false;
  }
  return (
    isLoopbackRedirect(a) &&
    isLoopbackRedirect(b) &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    !b.hash
  );
}

function fromRow(row: ClientRow): OAuthClient {
  return {
    clientId: row.client_id,
    kind: row.kind,
    clientName: row.client_name || 'Application MCP',
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    authMethod: row.token_endpoint_auth_method,
    secretHash: row.client_secret_hash,
  };
}

const registrationSchema = z
  .object({
    redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
    client_name: z.string().trim().max(100).optional(),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).max(10).optional(),
    response_types: z.array(z.string()).max(10).optional(),
    scope: z.string().max(1000).optional(),
    application_type: z.string().max(20).optional(),
    client_uri: z.string().max(2000).optional(),
    logo_uri: z.string().max(2000).optional(),
  })
  .loose();

const SUPPORTED_AUTH: readonly AuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic'];

export function registerClient(db: Db, config: Config, body: unknown): Record<string, unknown> {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new OAuthFailure('invalid_client_metadata', `${issue?.path.join('.') || 'body'}: ${issue?.message}`);
  }
  const request = parsed.data;
  for (const uri of request.redirect_uris) {
    const problem = checkRedirectUri(uri, config.oauth.redirectHosts);
    if (problem) throw new OAuthFailure('invalid_redirect_uri', problem);
  }
  const authMethod = (request.token_endpoint_auth_method ?? 'client_secret_basic') as AuthMethod;
  if (!SUPPORTED_AUTH.includes(authMethod)) {
    throw new OAuthFailure('invalid_client_metadata', `token_endpoint_auth_method ${authMethod} is not supported`);
  }
  if (request.grant_types && !request.grant_types.includes('authorization_code')) {
    throw new OAuthFailure('invalid_client_metadata', 'grant_types must include authorization_code');
  }
  if (request.response_types && !request.response_types.includes('code')) {
    throw new OAuthFailure('invalid_client_metadata', 'response_types must include code');
  }
  const count = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM oauth_clients WHERE kind = 'dcr'")?.n ?? 0;
  if (count >= MAX_DCR_CLIENTS) throw new OAuthFailure('invalid_client_metadata', 'too many registered clients', 429);

  const clientId = `plt_client_${randomToken(18)}`;
  const secret = authMethod === 'none' ? null : randomToken(32);
  const issuedAt = Math.floor(Date.now() / 1000);
  const registration: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: issuedAt,
    client_name: request.client_name || undefined,
    redirect_uris: request.redirect_uris,
    token_endpoint_auth_method: authMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: SCOPE,
  };
  if (request.application_type) registration.application_type = request.application_type;
  run(
    db,
    `INSERT INTO oauth_clients (client_id, kind, client_secret_hash, client_name, redirect_uris,
       token_endpoint_auth_method, registration, created_at)
     VALUES (:id, 'dcr', :secret, :name, :uris, :method, :registration, :now)`,
    {
      id: clientId,
      secret: secret ? sha256(secret) : null,
      name: request.client_name || null,
      uris: JSON.stringify(request.redirect_uris),
      method: authMethod,
      registration: JSON.stringify(registration),
      now: new Date().toISOString(),
    },
  );
  return secret ? { ...registration, client_secret: secret, client_secret_expires_at: 0 } : registration;
}

const cimdSchema = z
  .object({
    client_id: z.string(),
    client_name: z.string().trim().max(100).optional(),
    redirect_uris: z.array(z.string().max(2000)).min(1).max(20),
    token_endpoint_auth_method: z.string().optional(),
  })
  .loose();

const MAX_CIMD_BYTES = 64 * 1024;

function cacheSeconds(header: string | null): number {
  const maxAge = header ? /max-age=(\d+)/i.exec(header)?.[1] : undefined;
  const seconds = maxAge ? Number(maxAge) : 3600;
  return Math.min(Math.max(seconds, 300), 86_400);
}

async function fetchClientMetadata(
  db: Db,
  config: Config,
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<OAuthClient> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new OAuthFailure('invalid_client', 'client_id is not a valid URL');
  }
  if (url.protocol !== 'https:' || url.pathname === '/' || url.hash || url.username || url.password) {
    throw new OAuthFailure('invalid_client', 'client metadata URLs must be https with a path');
  }
  if (!hostAllowed(url.hostname, config.oauth.cimdHosts)) {
    throw new OAuthFailure('invalid_client', `client metadata host ${url.hostname} is not trusted by this server`);
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new OAuthFailure('invalid_client', 'client metadata document could not be fetched');
  }
  if (!response.ok) throw new OAuthFailure('invalid_client', `client metadata document returned ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_CIMD_BYTES) throw new OAuthFailure('invalid_client', 'client metadata document is too large');
  const text = await response.text();
  if (text.length > MAX_CIMD_BYTES) throw new OAuthFailure('invalid_client', 'client metadata document is too large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new OAuthFailure('invalid_client', 'client metadata document is not JSON');
  }
  const parsed = cimdSchema.safeParse(json);
  if (!parsed.success) throw new OAuthFailure('invalid_client', 'client metadata document is missing required fields');
  const doc = parsed.data;
  if (doc.client_id !== clientId) throw new OAuthFailure('invalid_client', 'client_id does not match the document URL');
  const method = doc.token_endpoint_auth_method ?? 'none';
  if (method !== 'none')
    throw new OAuthFailure('invalid_client', `token_endpoint_auth_method ${method} is not supported`);
  for (const uri of doc.redirect_uris) {
    const problem = checkRedirectUri(uri, 'any');
    if (problem) throw new OAuthFailure('invalid_client', problem);
  }
  const expiresAt = new Date(Date.now() + cacheSeconds(response.headers.get('cache-control')) * 1000).toISOString();
  const name = doc.client_name || url.hostname;
  run(
    db,
    `INSERT INTO oauth_clients (client_id, kind, client_name, redirect_uris, token_endpoint_auth_method, registration, created_at, expires_at)
     VALUES (:id, 'cimd', :name, :uris, 'none', :registration, :now, :expires)
     ON CONFLICT(client_id) DO UPDATE SET client_name = :name, redirect_uris = :uris, registration = :registration, expires_at = :expires`,
    {
      id: clientId,
      name,
      uris: JSON.stringify(doc.redirect_uris),
      registration: JSON.stringify(doc),
      now: new Date().toISOString(),
      expires: expiresAt,
    },
  );
  return {
    clientId,
    kind: 'cimd',
    clientName: name,
    redirectUris: doc.redirect_uris,
    authMethod: 'none',
    secretHash: null,
  };
}

/** Looks a client up (fetching its metadata document when needed). Throws invalid_client. */
export async function findClient(
  db: Db,
  config: Config,
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<OAuthClient> {
  if (!clientId || clientId.length > 2000) throw new OAuthFailure('invalid_client', 'unknown client');
  const row = get<ClientRow>(db, 'SELECT * FROM oauth_clients WHERE client_id = :id', { id: clientId });
  if (clientId.startsWith('https://')) {
    if (row && row.kind === 'cimd' && row.expires_at && Date.parse(row.expires_at) > Date.now()) return fromRow(row);
    return fetchClientMetadata(db, config, clientId, fetchImpl);
  }
  if (!row || row.kind !== 'dcr') throw new OAuthFailure('invalid_client', 'unknown client');
  return fromRow(row);
}

/** Token/revocation endpoint client authentication. */
export async function authenticateClient(
  db: Db,
  config: Config,
  input: { basic: { id: string; secret: string } | null; clientId?: string; clientSecret?: string },
  fetchImpl: typeof fetch,
): Promise<OAuthClient> {
  const clientId = input.basic?.id ?? input.clientId;
  if (!clientId) throw new OAuthFailure('invalid_client', 'client authentication required', 401);
  if (input.basic && input.clientId && input.clientId !== input.basic.id) {
    throw new OAuthFailure('invalid_request', 'client_id does not match the Authorization header');
  }
  let client: OAuthClient;
  try {
    client = await findClient(db, config, clientId, fetchImpl);
  } catch (error) {
    if (error instanceof OAuthFailure) throw new OAuthFailure('invalid_client', error.description, 401);
    throw error;
  }
  if (client.authMethod === 'none') return client;
  const secret = input.basic?.secret ?? input.clientSecret;
  if (!secret || !client.secretHash || !safeEqual(sha256(secret), client.secretHash)) {
    throw new OAuthFailure('invalid_client', 'client authentication failed', 401);
  }
  return client;
}

export function purgeClients(db: Db): void {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  run(
    db,
    `DELETE FROM oauth_clients WHERE created_at < :cutoff
       AND client_id NOT IN (SELECT client_id FROM oauth_grants WHERE revoked_at IS NULL)`,
    { cutoff },
  );
}
