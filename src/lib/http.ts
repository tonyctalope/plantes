import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/**
 * Client IP for rate limiting. Behind Traefik the right-most X-Forwarded-For
 * entry is the address Traefik saw; without a proxy we use the socket.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    const last = hops.at(-1);
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Fixed-window in-memory limiter: enough for one small instance. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Returns false when the key is over its budget for the current window. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size > 10_000) this.sweep(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

/** Local path safe to redirect to after login (no scheme, no host, no //). */
export function safeNextPath(next: string | undefined | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\\]/.test(next) || next.length > 2000) return '/';
  return next;
}

/** True when the request carries an Origin header equal to ours. */
export function isSameOrigin(c: Context, origin: string): boolean {
  return c.req.header('origin') === origin;
}
