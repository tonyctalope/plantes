import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { get, run, type Db } from '../db/database.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const UPLOAD_LINK_TTL_MS = 24 * 3600 * 1000;
const MAX_UPLOADS_PER_LINK = 10;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'gif', 'tiff']);
const STEM = /^[A-Za-z0-9_-]{22}$/;

export class PhotoError extends Error {
  readonly status: 400 | 413 | 415;

  constructor(message: string, status: 400 | 413 | 415 = 400) {
    super(message);
    this.status = status;
  }
}

export function photoDir(dataDir: string): string {
  return path.join(dataDir, 'photos');
}

/** Maps a public file name (`<stem>.webp` / `<stem>-thumb.webp`) to a path, or null. */
export function photoFile(dataDir: string, fileName: string): string | null {
  const match = /^([A-Za-z0-9_-]{22})(-thumb)?\.webp$/.exec(fileName);
  return match ? path.join(photoDir(dataDir), fileName) : null;
}

/**
 * Normalises an uploaded image: auto-rotates from EXIF, strips every metadata
 * block (phone photos carry the GPS position of the home), and writes a
 * 1600 px WebP plus a 480 px square thumbnail cropped on the interesting part.
 */
// Decoding a big image can take a few hundred MB: process one photo at a time.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

export function storePhoto(dataDir: string, input: Uint8Array): Promise<string> {
  if (input.byteLength === 0) return Promise.reject(new PhotoError('Fichier vide.'));
  if (input.byteLength > MAX_PHOTO_BYTES) {
    return Promise.reject(new PhotoError('Photo trop lourde (20 Mo maximum).', 413));
  }
  return oneAtATime(() => processPhoto(dataDir, input));
}

async function processPhoto(dataDir: string, input: Uint8Array): Promise<string> {
  const options = { failOn: 'error' as const, limitInputPixels: 70_000_000 };
  let format: string | undefined;
  try {
    format = (await sharp(input, options).metadata()).format;
  } catch {
    throw new PhotoError("Ce fichier n'est pas une image lisible.", 415);
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new PhotoError(`Format d'image non pris en charge (${format ?? 'inconnu'}).`, 415);
  }
  const dir = photoDir(dataDir);
  await mkdir(dir, { recursive: true });
  const stem = randomToken(16);
  try {
    // Decode the original once; the thumbnail is cut from the 1600 px result.
    const full = await sharp(input, options)
      .autoOrient()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const thumb = await sharp(full)
      .resize({ width: 480, height: 480, fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 76 })
      .toBuffer();
    await Promise.all([
      writeFile(path.join(dir, `${stem}.webp`), full),
      writeFile(path.join(dir, `${stem}-thumb.webp`), thumb),
    ]);
  } catch (error) {
    await deletePhoto(dataDir, stem);
    console.warn(`photo processing failed (${format}): ${(error as Error).message}`);
    const heic = format === 'heif' ? ' Les photos HEIC (iPhone) doivent être converties en JPEG.' : '';
    throw new PhotoError(`Impossible de traiter cette image.${heic}`, 415);
  }
  return stem;
}

export async function deletePhoto(dataDir: string, stem: string | null): Promise<void> {
  if (!stem || !STEM.test(stem)) return;
  const dir = photoDir(dataDir);
  await Promise.all([
    rm(path.join(dir, `${stem}.webp`), { force: true }),
    rm(path.join(dir, `${stem}-thumb.webp`), { force: true }),
  ]);
}

/** Base64 of the thumbnail, for showing the plant to Claude. */
export async function readThumbnail(dataDir: string, stem: string): Promise<string | null> {
  if (!STEM.test(stem)) return null;
  try {
    return (await readFile(path.join(photoDir(dataDir), `${stem}-thumb.webp`))).toString('base64');
  } catch {
    return null;
  }
}

// One-time-ish capability links that let a phone attach the photo to a plant
// Claude just created (Claude cannot forward the image bytes it was shown).

const MAX_LINKS_PER_PLANT = 3;
const MAX_LIVE_LINKS = 300;

export class UploadLinkLimitError extends Error {}

export function createUploadLink(
  db: Db,
  plantId: number,
  userId: number | null,
  options: { setCover?: boolean } = {},
): { token: string; expiresAt: string } {
  const token = randomToken();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // Keep only the newest links of this plant, and a global ceiling.
  run(
    db,
    `DELETE FROM photo_upload_tokens WHERE plant_id = :plant AND token_hash NOT IN (
       SELECT token_hash FROM photo_upload_tokens WHERE plant_id = :plant ORDER BY created_at DESC LIMIT :keep)`,
    { plant: plantId, keep: MAX_LINKS_PER_PLANT - 1 },
  );
  const live = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM photo_upload_tokens WHERE expires_at > :now', {
    now: nowIso,
  });
  if ((live?.n ?? 0) >= MAX_LIVE_LINKS) throw new UploadLinkLimitError('too many live upload links, retry tomorrow');
  const expiresAt = new Date(now + UPLOAD_LINK_TTL_MS).toISOString();
  run(
    db,
    `INSERT INTO photo_upload_tokens (token_hash, plant_id, created_by, created_at, expires_at, set_cover)
     VALUES (:hash, :plant, :user, :now, :expires, :cover)`,
    {
      hash: sha256(token),
      plant: plantId,
      user: userId,
      now: new Date(now).toISOString(),
      expires: expiresAt,
      cover: options.setCover ? 1 : 0,
    },
  );
  return { token, expiresAt };
}

export interface UploadLink {
  plantId: number;
  createdBy: number | null;
  uploads: number;
  hash: string;
  setCover: boolean;
}

export function resolveUploadLink(db: Db, token: string, isAllowed: (email: string) => boolean): UploadLink | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = sha256(token);
  const row = get<{
    plant_id: number;
    created_by: number | null;
    uploads: number;
    expires_at: string;
    email: string | null;
    set_cover: number;
  }>(
    db,
    `SELECT t.plant_id, t.created_by, t.uploads, t.expires_at, t.set_cover, u.email
       FROM photo_upload_tokens t LEFT JOIN users u ON u.id = t.created_by WHERE t.token_hash = :hash`,
    { hash },
  );
  if (!row || Date.parse(row.expires_at) <= Date.now() || row.uploads >= MAX_UPLOADS_PER_LINK) return null;
  // A link dies with its creator's access.
  if (!row.email || !isAllowed(row.email)) return null;
  return {
    plantId: row.plant_id,
    createdBy: row.created_by,
    uploads: row.uploads,
    hash,
    setCover: row.set_cover === 1,
  };
}

export function countUpload(db: Db, hash: string): void {
  run(db, 'UPDATE photo_upload_tokens SET uploads = uploads + 1 WHERE token_hash = :hash', { hash });
}

export function purgeUploadLinks(db: Db): void {
  run(db, 'DELETE FROM photo_upload_tokens WHERE expires_at <= :now', { now: new Date().toISOString() });
}
