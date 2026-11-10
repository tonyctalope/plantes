import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { purgeExpiredSessions } from './auth/sessions.ts';
import { run } from './db/database.ts';
import { localDate, localTime } from './lib/time.ts';
import { purgeClients } from './oauth/clients.ts';
import { purgeOAuth } from './oauth/tokens.ts';
import { purgeUploadLinks } from './plants/photos.ts';
import { runReminders } from './push/reminders.ts';
import type { Deps } from './types.ts';

const KEEP_BACKUPS = 14;

/** Consistent snapshot of the database (photos live next to it in DATA_DIR/photos). */
export function backupDatabase(deps: Deps, date: string): string | null {
  const dir = path.join(deps.config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `plantes-${date}.db`);
  if (existsSync(file)) return null;
  run(deps.db, 'VACUUM INTO :file', { file });
  const old = readdirSync(dir)
    .filter((name) => /^plantes-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const name of old) rmSync(path.join(dir, name), { force: true });
  return file;
}

export function startJobs(deps: Deps): () => void {
  let busy = false;
  let lastPurge = 0;
  let lastBackup = '';
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runReminders(deps);
      if (Date.now() - lastPurge > 10 * 60_000) {
        purgeExpiredSessions(deps.db);
        purgeOAuth(deps.db);
        purgeClients(deps.db);
        purgeUploadLinks(deps.db);
        lastPurge = Date.now();
      }
      const now = deps.now();
      const today = localDate(now, deps.config.timezone);
      if (today !== lastBackup && localTime(now, deps.config.timezone) >= '03:30') {
        const file = backupDatabase(deps, today);
        if (file) console.info(`backup written: ${file}`);
        lastBackup = today;
      }
    } catch (error) {
      console.error('background job failed:', error);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
