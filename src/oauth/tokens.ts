import { get, all, run, transaction, type Db } from '../db/database.ts';
import { isValidPkceVerifier, pkceChallenge, randomToken, safeEqual, sha256 } from '../lib/crypto.ts';
import type { OAuthClient } from './clients.ts';
import { OAuthFailure } from './errors.ts';

// Authorization codes, grants and tokens. Every secret is random (256 bits),
// prefixed for recognisability and stored only as a SHA-256 hash. A grant is
// one user's authorization of one client; its tokens die with it.

const CODE_PREFIX = 'plt_code_';
const ACCESS_PREFIX = 'plt_at_';
const REFRESH_PREFIX = 'plt_rt_';
const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
/** A rotated refresh token may be replayed this long (client retry / concurrent refresh) before it counts as theft. */
const REFRESH_REUSE_GRACE_MS = 60 * 1000;

/**
 * Successor of each refresh token rotated in the last minute, kept in memory
 * only (never on disk): a replay inside the grace window gets the very same
 * successor back instead of minting another live refresh token.
 */
const recentRotations = new Map<string, { tokens: TokenResponse; accessExpiresAt: number; until: number }>();

function rememberRotation(hash: string, tokens: TokenResponse): void {
  const now = Date.now();
  for (const [key, entry] of recentRotations) if (entry.until <= now) recentRotations.delete(key);
  recentRotations.set(hash, {
    tokens,
    accessExpiresAt: now + tokens.expires_in * 1000,
    until: now + REFRESH_REUSE_GRACE_MS,
  });
}

export interface TokenTtls {
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface PendingRequest {
  clientId: string;
  redirectUri: string;
  redirectUriProvided: boolean;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string;
  sessionHash: string | null;
}

// --- pending authorization requests (between /authorize and the consent form)

const MAX_PENDING_REQUESTS = 5000;

/** Anonymous clients create these rows: keep the table bounded. */
export function hasRoomForPendingRequest(db: Db): boolean {
  const count = () => get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM oauth_requests')?.n ?? 0;
  if (count() < MAX_PENDING_REQUESTS) return true;
  run(db, 'DELETE FROM oauth_requests WHERE expires_at <= :now', { now: new Date().toISOString() });
  return count() < MAX_PENDING_REQUESTS;
}

export function savePendingRequest(db: Db, request: Omit<PendingRequest, 'sessionHash'>): string {
  const id = randomToken(24);
  run(
    db,
    `INSERT INTO oauth_requests (id_hash, client_id, redirect_uri, redirect_uri_provided, state, code_challenge, scope, resource, expires_at)
     VALUES (:id, :client, :redirect, :provided, :state, :challenge, :scope, :resource, :expires)`,
    {
      id: sha256(id),
      client: request.clientId,
      redirect: request.redirectUri,
      provided: request.redirectUriProvided ? 1 : 0,
      state: request.state,
      challenge: request.codeChallenge,
      scope: request.scope,
      resource: request.resource,
      expires: new Date(Date.now() + REQUEST_TTL_MS).toISOString(),
    },
  );
  return id;
}

interface RequestRow {
  client_id: string;
  redirect_uri: string;
  redirect_uri_provided: number;
  state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
  session_hash: string | null;
  expires_at: string;
}

/**
 * Loads a pending request for the consent page and binds it to the browser
 * session that first opens it; another session cannot use it afterwards.
 */
export function loadPendingRequest(db: Db, id: string, sessionHash: string): PendingRequest | null {
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return null;
  const idHash = sha256(id);
  const row = get<RequestRow>(db, 'SELECT * FROM oauth_requests WHERE id_hash = :id', { id: idHash });
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  if (row.session_hash === null) {
    run(db, 'UPDATE oauth_requests SET session_hash = :session WHERE id_hash = :id AND session_hash IS NULL', {
      session: sessionHash,
      id: idHash,
    });
  } else if (!safeEqual(row.session_hash, sessionHash)) {
    return null;
  }
  return {
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    redirectUriProvided: row.redirect_uri_provided === 1,
    state: row.state,
    codeChallenge: row.code_challenge,
    scope: row.scope,
    resource: row.resource,
    sessionHash,
  };
}

export function deletePendingRequest(db: Db, id: string): void {
  run(db, 'DELETE FROM oauth_requests WHERE id_hash = :id', { id: sha256(id) });
}

// --- authorization codes

export function issueCode(db: Db, request: PendingRequest, userId: number): string {
  const code = CODE_PREFIX + randomToken();
  run(
    db,
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, redirect_uri_provided, code_challenge, scope, resource, expires_at)
     VALUES (:code, :client, :user, :redirect, :provided, :challenge, :scope, :resource, :expires)`,
    {
      code: sha256(code),
      client: request.clientId,
      user: userId,
      redirect: request.redirectUri,
      provided: request.redirectUriProvided ? 1 : 0,
      challenge: request.codeChallenge,
      scope: request.scope,
      resource: request.resource,
      expires: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    },
  );
  return code;
}

interface CodeRow {
  client_id: string;
  user_id: number;
  redirect_uri: string;
  redirect_uri_provided: number;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
  used_at: string | null;
  grant_id: string | null;
  email: string;
}

type Outcome = { ok: true; tokens: TokenResponse } | { ok: false; error: OAuthFailure };

function revokeGrantInternal(db: Db, grantId: string): void {
  const now = new Date().toISOString();
  run(db, 'UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, :now) WHERE id = :id', { now, id: grantId });
  run(db, 'DELETE FROM oauth_tokens WHERE grant_id = :id', { id: grantId });
}

function issueTokens(db: Db, grantId: string, scope: string, ttl: TokenTtls): TokenResponse {
  const now = Date.now();
  const accessToken = ACCESS_PREFIX + randomToken();
  const refreshToken = REFRESH_PREFIX + randomToken();
  const insert = `INSERT INTO oauth_tokens (token_hash, grant_id, type, created_at, expires_at) VALUES (:hash, :grant, :type, :now, :expires)`;
  run(db, insert, {
    hash: sha256(accessToken),
    grant: grantId,
    type: 'access',
    now: new Date(now).toISOString(),
    expires: new Date(now + ttl.accessTokenTtlSec * 1000).toISOString(),
  });
  run(db, insert, {
    hash: sha256(refreshToken),
    grant: grantId,
    type: 'refresh',
    now: new Date(now).toISOString(),
    expires: new Date(now + ttl.refreshTokenTtlSec * 1000).toISOString(),
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ttl.accessTokenTtlSec,
    refresh_token: refreshToken,
    scope,
  };
}

/** The requested resource names the granted one (our MCP endpoint), or its bare origin like /authorize accepts. */
function sameResource(requested: string, granted: string): boolean {
  const normalise = (value: string) => {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}${url.search}`.toLowerCase();
    } catch {
      return value;
    }
  };
  const wanted = normalise(requested);
  if (wanted === normalise(granted)) return true;
  try {
    return wanted === new URL(granted).origin.toLowerCase();
  } catch {
    return false;
  }
}

export function exchangeCode(
  db: Db,
  client: OAuthClient,
  params: { code: string; redirectUri?: string; codeVerifier?: string; resource?: string },
  isAllowed: (email: string) => boolean,
  ttl: TokenTtls,
): Outcome {
  return transaction(db, (): Outcome => {
    const fail = (description: string, code = 'invalid_grant'): Outcome => ({
      ok: false,
      error: new OAuthFailure(code, description),
    });
    if (!params.code.startsWith(CODE_PREFIX)) return fail('invalid authorization code');
    const hash = sha256(params.code);
    const row = get<CodeRow>(
      db,
      `SELECT c.*, u.email FROM oauth_codes c JOIN users u ON u.id = c.user_id WHERE c.code_hash = :hash`,
      { hash },
    );
    if (!row) return fail('invalid authorization code');
    if (row.used_at) {
      // Replay: the code leaked. Kill whatever it produced (RFC 9700 §4.5.3.1).
      if (row.grant_id) revokeGrantInternal(db, row.grant_id);
      return fail('authorization code already used');
    }
    if (Date.parse(row.expires_at) <= Date.now()) return fail('authorization code expired');
    if (row.client_id !== client.clientId) return fail('authorization code was issued to another client');
    if (params.redirectUri !== undefined) {
      // OAuth 2.1 §4.1.3: identical to the value sent to /authorize.
      if (params.redirectUri !== row.redirect_uri) return fail('redirect_uri does not match the authorization request');
    } else if (row.redirect_uri_provided === 1) {
      return fail('redirect_uri is required', 'invalid_request');
    }
    if (!params.codeVerifier) return fail('code_verifier is required', 'invalid_request');
    if (
      !isValidPkceVerifier(params.codeVerifier) ||
      !safeEqual(pkceChallenge(params.codeVerifier), row.code_challenge)
    ) {
      return fail('PKCE verification failed');
    }
    if (params.resource !== undefined && !sameResource(params.resource, row.resource)) {
      return fail('resource does not match the authorization request', 'invalid_target');
    }
    if (!isAllowed(row.email)) return fail('this account is no longer allowed');

    const grantId = randomToken(16);
    const now = new Date().toISOString();
    run(
      db,
      `INSERT INTO oauth_grants (id, client_id, client_name, user_id, scope, resource, created_at, last_used_at)
       VALUES (:id, :client, :name, :user, :scope, :resource, :now, :now)`,
      {
        id: grantId,
        client: client.clientId,
        name: client.clientName,
        user: row.user_id,
        scope: row.scope,
        resource: row.resource,
        now,
      },
    );
    run(db, 'UPDATE oauth_codes SET used_at = :now, grant_id = :grant WHERE code_hash = :hash', {
      now,
      grant: grantId,
      hash,
    });
    return { ok: true, tokens: issueTokens(db, grantId, row.scope, ttl) };
  });
}

interface RefreshRow {
  grant_id: string;
  expires_at: string;
  rotated_at: string | null;
  client_id: string;
  scope: string;
  resource: string;
  revoked_at: string | null;
  email: string;
}

export function refreshTokens(
  db: Db,
  client: OAuthClient,
  params: { refreshToken: string; scope?: string; resource?: string },
  isAllowed: (email: string) => boolean,
  ttl: TokenTtls,
): Outcome {
  return transaction(db, (): Outcome => {
    const fail = (description: string, code = 'invalid_grant'): Outcome => ({
      ok: false,
      error: new OAuthFailure(code, description),
    });
    if (!params.refreshToken.startsWith(REFRESH_PREFIX)) return fail('invalid refresh token');
    const hash = sha256(params.refreshToken);
    const row = get<RefreshRow>(
      db,
      `SELECT t.grant_id, t.expires_at, t.rotated_at, g.client_id, g.scope, g.resource, g.revoked_at, u.email
         FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
        WHERE t.token_hash = :hash AND t.type = 'refresh'`,
      { hash },
    );
    if (!row || row.revoked_at) return fail('invalid refresh token');
    if (row.client_id !== client.clientId) return fail('refresh token was issued to another client');
    if (Date.parse(row.expires_at) <= Date.now()) return fail('refresh token expired');
    if (row.rotated_at) {
      const replay = recentRotations.get(hash);
      if (Date.now() - Date.parse(row.rotated_at) <= REFRESH_REUSE_GRACE_MS && replay && !row.revoked_at) {
        // Lost response or concurrent refresh: answer with the same successor.
        const expiresIn = Math.max(1, Math.round((replay.accessExpiresAt - Date.now()) / 1000));
        return { ok: true, tokens: { ...replay.tokens, expires_in: expiresIn } };
      }
      revokeGrantInternal(db, row.grant_id);
      recentRotations.delete(hash);
      return fail('refresh token already used; the authorization was revoked');
    }
    if (!isAllowed(row.email)) {
      revokeGrantInternal(db, row.grant_id);
      return fail('this account is no longer allowed');
    }
    if (params.resource !== undefined && !sameResource(params.resource, row.resource)) {
      return fail('resource does not match the grant', 'invalid_target');
    }
    if (params.scope !== undefined) {
      const granted = new Set(row.scope.split(' '));
      if (
        !params.scope
          .split(' ')
          .filter(Boolean)
          .every((scope) => granted.has(scope))
      ) {
        return fail('requested scope exceeds the grant', 'invalid_scope');
      }
    }
    const now = new Date().toISOString();
    run(db, 'UPDATE oauth_tokens SET rotated_at = :now WHERE token_hash = :hash', { now, hash });
    run(db, 'UPDATE oauth_grants SET last_used_at = :now WHERE id = :id', { now, id: row.grant_id });
    const tokens = issueTokens(db, row.grant_id, row.scope, ttl);
    rememberRotation(hash, tokens);
    return { ok: true, tokens };
  });
}

/** RFC 7009: revoking either token of a grant ends the whole grant. */
export function revokeToken(db: Db, client: OAuthClient, token: string): void {
  const row = get<{ grant_id: string; client_id: string }>(
    db,
    `SELECT t.grant_id, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = :hash`,
    { hash: sha256(token) },
  );
  if (row && row.client_id === client.clientId) transaction(db, () => revokeGrantInternal(db, row.grant_id));
}

export interface VerifiedAccess {
  grantId: string;
  clientId: string;
  clientName: string;
  userId: number;
  email: string;
  scopes: string[];
  resource: string;
  expiresAt: number;
}

export function verifyAccessToken(db: Db, token: string, isAllowed: (email: string) => boolean): VerifiedAccess | null {
  if (!token.startsWith(ACCESS_PREFIX) || token.length > 200) return null;
  const row = get<{
    expires_at: string;
    grant_id: string;
    client_id: string;
    client_name: string;
    user_id: number;
    scope: string;
    resource: string;
    revoked_at: string | null;
    last_used_at: string | null;
    email: string;
  }>(
    db,
    `SELECT t.expires_at, g.id AS grant_id, g.client_id, g.client_name, g.user_id, g.scope, g.resource, g.revoked_at,
            g.last_used_at, u.email
       FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
      WHERE t.token_hash = :hash AND t.type = 'access'`,
    { hash: sha256(token) },
  );
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now() || !isAllowed(row.email)) return null;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 5 * 60 * 1000) {
    run(db, 'UPDATE oauth_grants SET last_used_at = :now WHERE id = :id', {
      now: new Date().toISOString(),
      id: row.grant_id,
    });
  }
  return {
    grantId: row.grant_id,
    clientId: row.client_id,
    clientName: row.client_name,
    userId: row.user_id,
    email: row.email,
    scopes: row.scope.split(' ').filter(Boolean),
    resource: row.resource,
    expiresAt: Math.floor(Date.parse(row.expires_at) / 1000),
  };
}

export function listGrants(
  db: Db,
  userId: number,
): { id: string; clientName: string; createdAt: string; lastUsedAt: string | null }[] {
  return all<{ id: string; client_name: string; created_at: string; last_used_at: string | null }>(
    db,
    `SELECT id, client_name, created_at, last_used_at FROM oauth_grants
      WHERE user_id = :user AND revoked_at IS NULL ORDER BY created_at DESC`,
    { user: userId },
  ).map((row) => ({
    id: row.id,
    clientName: row.client_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export function revokeGrant(db: Db, grantId: string, userId: number): boolean {
  const row = get<{ id: string }>(
    db,
    'SELECT id FROM oauth_grants WHERE id = :id AND user_id = :user AND revoked_at IS NULL',
    {
      id: grantId,
      user: userId,
    },
  );
  if (!row) return false;
  transaction(db, () => revokeGrantInternal(db, row.id));
  return true;
}

export function purgeOAuth(db: Db): void {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  run(db, 'DELETE FROM oauth_requests WHERE expires_at <= :now', { now });
  run(db, 'DELETE FROM oauth_codes WHERE expires_at <= :old', { old });
  run(db, 'DELETE FROM oauth_tokens WHERE expires_at <= :now', { now });
  run(db, 'DELETE FROM oauth_grants WHERE revoked_at IS NOT NULL AND revoked_at <= :old', { old });
  // Grants whose refresh tokens all expired are dead too.
  run(
    db,
    `UPDATE oauth_grants SET revoked_at = :now WHERE revoked_at IS NULL
       AND id NOT IN (SELECT grant_id FROM oauth_tokens WHERE type = 'refresh')`,
    { now },
  );
}
