import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// The built web app (dist/web) is small: load it once into memory and serve
// only files that exist there, so request paths never touch the filesystem.

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticFile {
  body: Uint8Array<ArrayBuffer>;
  type: string;
  cacheControl: string;
}

export function loadStaticFiles(root: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const url = `/${path.relative(root, full).split(path.sep).join('/')}`;
      const type = TYPES[path.extname(entry).toLowerCase()];
      if (!type) continue;
      files.set(url, {
        body: new Uint8Array(readFileSync(full)),
        type,
        cacheControl: url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    }
  };
  walk(root);
  return files;
}

/** Client-side routes of the SPA (served with index.html). */
export function isAppRoute(pathname: string): boolean {
  return (
    pathname === '/' || pathname === '/reglages' || pathname === '/archives' || /^\/plante\/\d+\/?$/.test(pathname)
  );
}
