import type { IdentityProvider } from './auth/google.ts';
import type { ActiveSession } from './auth/sessions.ts';
import type { Config } from './config.ts';
import type { Db } from './db/database.ts';
import type { PushService } from './push/push.ts';

export interface Deps {
  config: Config;
  db: Db;
  identity: IdentityProvider;
  push: PushService;
  /** Used to fetch Client ID Metadata Documents (injectable for tests). */
  fetch: typeof fetch;
  now: () => Date;
}

export interface AppEnv {
  Variables: {
    session: ActiveSession | null;
  };
}

export function allowlist(config: Config): (email: string) => boolean {
  return (email) => config.allowedEmails.has(email.toLowerCase());
}
