import path from 'node:path';

export interface Config {
  /** Public origin, e.g. https://plantes.example.com (no trailing slash). */
  origin: string;
  /** OAuth issuer identifier of the built-in authorization server (= origin). */
  issuer: string;
  /** Canonical URI of the MCP endpoint (RFC 8707 resource). */
  mcpResource: string;
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
  google: { clientId: string; clientSecret: string; issuer: string };
  allowedEmails: ReadonlySet<string>;
  timezone: string;
  /** Free text appended to the MCP server instructions (household specifics). */
  householdContext: string;
  /** Months (1–12, inclusive) that use the growing-season watering interval. */
  growingMonths: { from: number; to: number };
  oauth: {
    /** Exact https redirect URIs accepted for MCP clients (besides loopback). */
    redirectUris: readonly string[];
    /** Hosts trusted to serve Client ID Metadata Documents (".example.com" = its subdomains). */
    cimdHosts: readonly string[];
    accessTokenTtlSec: number;
    refreshTokenTtlSec: number;
  };
  vapid: { publicKey: string | null; privateKey: string | null; subject: string };
  /** Local development only: /auth/dev-login signs in any allowlisted email. */
  devLogin: boolean;
  secureCookies: boolean;
}

export class ConfigError extends Error {}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

function parseMonths(value: string | undefined): { from: number; to: number } {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec((value ?? '4-9').trim());
  const from = Number(match?.[1]);
  const to = Number(match?.[2]);
  if (!match || from < 1 || from > 12 || to < 1 || to > 12) {
    throw new ConfigError('GROWING_SEASON_MONTHS must look like "4-9" (months 1-12)');
  }
  return { from, to };
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawUrl = env.PUBLIC_URL;
  if (!rawUrl) throw new ConfigError('PUBLIC_URL is required (e.g. https://plantes.example.com)');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`PUBLIC_URL is not a valid URL: ${rawUrl}`);
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ConfigError('PUBLIC_URL must use https:// (http:// is only accepted for localhost)');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError('PUBLIC_URL must be an origin without path, e.g. https://plantes.example.com');
  }
  const origin = url.origin;

  const allowedEmails = new Set(list(env.ALLOWED_EMAILS).map((email) => email.toLowerCase()));
  if (allowedEmails.size === 0) throw new ConfigError('ALLOWED_EMAILS must list at least one e-mail address');
  for (const email of allowedEmails) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConfigError(`ALLOWED_EMAILS: invalid address ${email}`);
  }

  const devLogin = env.DEV_LOGIN === '1' || env.DEV_LOGIN === 'true';
  if (devLogin && (!loopback || env.NODE_ENV !== 'development')) {
    throw new ConfigError('DEV_LOGIN is only allowed with NODE_ENV=development and a localhost PUBLIC_URL');
  }

  const clientId = env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
  if (!devLogin && (!clientId || !clientSecret)) {
    throw new ConfigError('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  const timezone = env.APP_TIMEZONE || 'Europe/Paris';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new ConfigError(`APP_TIMEZONE is not a valid IANA time zone: ${timezone}`);
  }

  const vapidPublic = env.VAPID_PUBLIC_KEY || null;
  const vapidPrivate = env.VAPID_PRIVATE_KEY || null;
  if (Boolean(vapidPublic) !== Boolean(vapidPrivate)) {
    throw new ConfigError('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither (keys are then generated)');
  }

  const dataDir = path.resolve(env.DATA_DIR || 'data');
  return {
    origin,
    issuer: origin,
    mcpResource: `${origin}/mcp`,
    port: positiveInt(env.PORT, 8787, 'PORT'),
    host: env.HOST || '0.0.0.0',
    dataDir,
    webDir: path.resolve(env.WEB_DIR || 'dist/web'),
    google: {
      clientId,
      clientSecret,
      issuer: env.GOOGLE_ISSUER || 'https://accounts.google.com',
    },
    allowedEmails,
    timezone,
    householdContext: (env.HOUSEHOLD_CONTEXT ?? '').trim(),
    growingMonths: parseMonths(env.GROWING_SEASON_MONTHS),
    oauth: {
      redirectUris: list(
        env.OAUTH_REDIRECT_URIS ?? 'https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback',
      ).map((uri) => {
        let parsed: URL;
        try {
          parsed = new URL(uri);
        } catch {
          throw new ConfigError(`OAUTH_REDIRECT_URIS: invalid URL ${uri}`);
        }
        if (parsed.protocol !== 'https:' || parsed.hash)
          throw new ConfigError(`OAUTH_REDIRECT_URIS: ${uri} must be https`);
        return parsed.href;
      }),
      cimdHosts: list(env.OAUTH_CIMD_HOSTS ?? 'claude.ai,claude.com,anthropic.com').map((h) => h.toLowerCase()),
      accessTokenTtlSec: positiveInt(env.OAUTH_ACCESS_TOKEN_TTL, 3600, 'OAUTH_ACCESS_TOKEN_TTL'),
      refreshTokenTtlSec: positiveInt(env.OAUTH_REFRESH_TOKEN_TTL, 90 * 24 * 3600, 'OAUTH_REFRESH_TOKEN_TTL'),
    },
    vapid: {
      publicKey: vapidPublic,
      privateKey: vapidPrivate,
      subject: env.VAPID_SUBJECT || origin,
    },
    devLogin,
    secureCookies: url.protocol === 'https:',
  };
}
