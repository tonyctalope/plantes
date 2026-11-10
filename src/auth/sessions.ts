import { get, run, type Db } from '../db/database.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import type { UserRow } from './users.ts';

export const SESSION_COOKIE = 'plantes_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
/** Sliding expiry is refreshed at most this often. */
const TOUCH_EVERY_MS = 3600 * 1000;

export interface SessionRow {
  id_hash: string;
  user_id: number;
  csrf_token: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
}

export interface ActiveSession {
  idHash: string;
  csrfToken: string;
  user: UserRow;
}

export function createSession(db: Db, userId: number, userAgent: string | null): { token: string; csrfToken: string } {
  const token = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  run(
    db,
    `INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, user_agent)
     VALUES (:id, :user, :csrf, :now, :now, :expires, :ua)`,
    {
      id: sha256(token),
      user: userId,
      csrf: csrfToken,
      now: now.toISOString(),
      expires: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      ua: userAgent?.slice(0, 300) ?? null,
    },
  );
  return { token, csrfToken };
}

/** Resolves a session cookie; enforces expiry and the e-mail allowlist on every use. */
export function resolveSession(db: Db, token: string, isAllowed: (email: string) => boolean): ActiveSession | null {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const idHash = sha256(token);
  const row = get<
    SessionRow & {
      u_id: number;
      email: string;
      name: string | null;
      google_sub: string | null;
      u_created: string;
      last_login_at: string | null;
    }
  >(
    db,
    `SELECT s.*, u.id AS u_id, u.email, u.name, u.google_sub, u.created_at AS u_created, u.last_login_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = :id`,
    { id: idHash },
  );
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now || !isAllowed(row.email)) {
    run(db, 'DELETE FROM sessions WHERE id_hash = :id', { id: idHash });
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > TOUCH_EVERY_MS) {
    run(db, 'UPDATE sessions SET last_seen_at = :now, expires_at = :expires WHERE id_hash = :id', {
      id: idHash,
      now: new Date(now).toISOString(),
      expires: new Date(now + SESSION_TTL_MS).toISOString(),
    });
  }
  return {
    idHash,
    csrfToken: row.csrf_token,
    user: {
      id: row.u_id,
      email: row.email,
      name: row.name,
      google_sub: row.google_sub,
      created_at: row.u_created,
      last_login_at: row.last_login_at,
    },
  };
}

export function deleteSession(db: Db, idHash: string): void {
  run(db, 'DELETE FROM sessions WHERE id_hash = :id', { id: idHash });
}

export function purgeExpiredSessions(db: Db): void {
  const now = new Date().toISOString();
  run(db, 'DELETE FROM sessions WHERE expires_at <= :now', { now });
  run(db, 'DELETE FROM login_states WHERE expires_at <= :now', { now });
}
