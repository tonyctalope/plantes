import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { Hono } from 'hono';
import { createApp } from '../src/app.ts';
import type { IdentityProvider } from '../src/auth/google.ts';
import { createSession } from '../src/auth/sessions.ts';
import { upsertUser } from '../src/auth/users.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { openDatabase } from '../src/db/database.ts';
import type { PlantFields } from '../src/plants/schema.ts';
import type { PushMessage, PushService } from '../src/push/push.ts';
import type { AppEnv, Deps } from '../src/types.ts';

export const TONY = 'tony@example.com';
export const CHLOE = 'chloe@example.org';
export const STRANGER = 'mallory@example.net';

export function testConfig(env: Record<string, string> = {}, origin = 'https://plantes.test'): Config {
  return loadConfig({
    PUBLIC_URL: origin,
    ALLOWED_EMAILS: `${TONY}, ${CHLOE}`,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    APP_TIMEZONE: 'Europe/Paris',
    WEB_DIR: path.join(tmpdir(), 'plantes-no-web'),
    ...env,
  });
}

export class FakePush implements PushService {
  readonly publicKey = 'BFakePublicKey';
  readonly sent: { userId: number; message: PushMessage }[] = [];
  async sendToUser(userId: number, message: PushMessage): Promise<number> {
    this.sent.push({ userId, message });
    return 1;
  }
}

export const unusedIdentity: IdentityProvider = {
  start: () => Promise.reject(new Error('identity provider not available in this test')),
  finish: () => Promise.reject(new Error('identity provider not available in this test')),
};

export interface TestContext {
  deps: Deps;
  app: Hono<AppEnv>;
  push: FakePush;
  clock: { now: Date };
  cleanup: () => void;
}

export function setup(
  options: {
    env?: Record<string, string>;
    origin?: string;
    fetch?: typeof fetch;
    identity?: IdentityProvider;
    now?: Date;
  } = {},
): TestContext {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'plantes-test-'));
  const config = testConfig({ DATA_DIR: dataDir, ...options.env }, options.origin);
  const db = openDatabase(':memory:');
  const push = new FakePush();
  const clock = { now: options.now ?? new Date() };
  const deps: Deps = {
    config,
    db,
    identity: options.identity ?? unusedIdentity,
    push,
    fetch: options.fetch ?? (() => Promise.reject(new Error('network disabled in tests'))),
    now: () => clock.now,
  };
  return {
    deps,
    app: createApp(deps),
    push,
    clock,
    cleanup: () => {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Creates (or reuses) the user and returns a Cookie header for a fresh session. */
export function login(
  ctx: TestContext,
  email: string,
  name = email.split('@')[0]!,
): { cookie: string; userId: number; csrf: string } {
  const user = upsertUser(ctx.deps.db, { sub: `sub-${email}`, email, name });
  const { token, csrfToken } = createSession(ctx.deps.db, user.id, 'vitest');
  const cookieName = ctx.deps.config.secureCookies ? '__Host-plantes_session' : 'plantes_session';
  return { cookie: `${cookieName}=${token}`, userId: user.id, csrf: csrfToken };
}

/** Headers of a same-origin browser request. */
export function browser(ctx: TestContext, cookie: string, json = true): Record<string, string> {
  return {
    cookie,
    origin: ctx.deps.config.origin,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

export function plantFields(overrides: Partial<PlantFields> = {}): PlantFields {
  return {
    nickname: 'Monstera du salon',
    common_name: 'Monstera deliciosa (faux philodendron)',
    scientific_name: 'Monstera deliciosa',
    family: 'Araceae',
    identification_confidence: 'high',
    identification_notes: 'Feuilles fenestrées caractéristiques.',
    room: 'Salon',
    indoor: true,
    light: 'bright_indirect',
    light_notes: 'Près de la fenêtre est.',
    water_interval_growing: 7,
    water_interval_rest: 12,
    watering_instructions: 'Arroser quand les 3 premiers cm sont secs.',
    water_amount: '≈ 400 ml',
    humidity: 'medium',
    temp_min_c: 15,
    temp_max_c: 30,
    toxicity_pets: 'toxic',
    toxicity_notes: 'Oxalates de calcium.',
    difficulty: 'easy',
    ...overrides,
  };
}

/** A small real JPEG (with an EXIF orientation tag) for upload tests. */
export async function sampleJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 120, b: 60 } } })
    .jpeg({ quality: 80 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** Extracts `name="value"` hidden inputs from a server-rendered form. */
export function hiddenInputs(page: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of page.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
    result[match[1]!] = match[2]!;
  }
  return result;
}
