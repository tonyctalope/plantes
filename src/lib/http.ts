import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/**
 * Rate-limit key for the client. Behind Traefik the right-most X-Forwarded-For
 * entry is the address Traefik saw; without a proxy we use the socket. IPv6
 * clients are grouped by /64 (one subscriber usually owns a whole /64).
 */
export function clientIp(c: Context): string {
  let address = 'unknown';
  const forwarded = c.req.header('x-forwarded-for');
  const last = forwarded
    ?.split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)
    .at(-1);
  if (last) {
    address = last;
  } else {
    try {
      address = getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      // not running on node-server (tests)
    }
  }
  return rateLimitKey(address);
}

export function rateLimitKey(address: string): string {
  const ip = address.replace(/^::ffff:/i, '');
  if (!ip.includes(':')) return ip;
  // Expand "::" and keep the first four hextets (the /64 prefix).
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/** Fixed-window in-memory limiter with bounded memory: enough for one small instance. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private nextSweep = 0;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Returns false when the key is over its budget for the current window. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (entry && entry.resetAt > now) {
      entry.count++;
      return entry.count <= this.limit;
    }
    if (now >= this.nextSweep) {
      for (const [stale, value] of this.hits) if (value.resetAt <= now) this.hits.delete(stale);
      this.nextSweep = now + this.windowMs;
    }
    if (this.hits.size >= 50_000) return false; // under a flood, new keys wait for the next sweep
    this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    return true;
  }
}

/** Local path safe to redirect to after login (no scheme, no host, no //). */
export function safeNextPath(next: string | undefined | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\\]/.test(next) || next.length > 500) return '/';
  return next;
}

/** True when the request carries an Origin header equal to ours. */
export function isSameOrigin(c: Context, origin: string): boolean {
  return c.req.header('origin') === origin;
}
