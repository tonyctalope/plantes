import { mkdir, readFile, rm } from 'node:fs/promises';
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
export async function storePhoto(dataDir: string, input: Uint8Array): Promise<string> {
  if (input.byteLength === 0) throw new PhotoError('Fichier vide.');
  if (input.byteLength > MAX_PHOTO_BYTES) throw new PhotoError('Photo trop lourde (20 Mo maximum).', 413);
  const options = { failOn: 'error' as const, limitInputPixels: 80_000_000 };
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
  const base = sharp(input, options).autoOrient();
  try {
    await Promise.all([
      base
        .clone()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(dir, `${stem}.webp`)),
      base
        .clone()
        .resize({ width: 480, height: 480, fit: 'cover', position: sharp.strategy.attention })
        .webp({ quality: 76 })
        .toFile(path.join(dir, `${stem}-thumb.webp`)),
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

export function createUploadLink(db: Db, plantId: number, userId: number | null): { token: string; expiresAt: string } {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = new Date(now + UPLOAD_LINK_TTL_MS).toISOString();
  run(
    db,
    `INSERT INTO photo_upload_tokens (token_hash, plant_id, created_by, created_at, expires_at)
     VALUES (:hash, :plant, :user, :now, :expires)`,
    { hash: sha256(token), plant: plantId, user: userId, now: new Date(now).toISOString(), expires: expiresAt },
  );
  return { token, expiresAt };
}

export interface UploadLink {
  plantId: number;
  createdBy: number | null;
  uploads: number;
  hash: string;
}

export function resolveUploadLink(db: Db, token: string): UploadLink | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = sha256(token);
  const row = get<{ plant_id: number; created_by: number | null; uploads: number; expires_at: string }>(
    db,
    'SELECT plant_id, created_by, uploads, expires_at FROM photo_upload_tokens WHERE token_hash = :hash',
    { hash },
  );
  if (!row || Date.parse(row.expires_at) <= Date.now() || row.uploads >= MAX_UPLOADS_PER_LINK) return null;
  return { plantId: row.plant_id, createdBy: row.created_by, uploads: row.uploads, hash };
}

export function countUpload(db: Db, hash: string): void {
  run(db, 'UPDATE photo_upload_tokens SET uploads = uploads + 1 WHERE token_hash = :hash', { hash });
}

export function purgeUploadLinks(db: Db): void {
  run(db, 'DELETE FROM photo_upload_tokens WHERE expires_at <= :now', { now: new Date().toISOString() });
}
