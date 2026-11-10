import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createGoogleProvider } from './auth/google.ts';
import { ConfigError, loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { startJobs } from './jobs.ts';
import { createPushService } from './push/push.ts';
import type { Deps } from './types.ts';

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

mkdirSync(config.dataDir, { recursive: true });
const db = openDatabase(path.join(config.dataDir, 'plantes.db'));
const deps: Deps = {
  config,
  db,
  identity: createGoogleProvider(config, db),
  push: createPushService(db, config),
  fetch: globalThis.fetch,
  now: () => new Date(),
};

const app = createApp(deps);
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.info(
    `plantes listening on ${info.address}:${info.port} — ${config.origin} (${config.allowedEmails.size} allowed account(s), tz ${config.timezone})`,
  );
});
const stopJobs = startJobs(deps);

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.info(`${signal} received, shutting down`);
  stopJobs();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
