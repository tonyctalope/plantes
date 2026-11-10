import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { messagePage } from '../pages/layout.ts';
import { uploadPage } from '../pages/upload.ts';
import { clientIp, RateLimiter } from '../lib/http.ts';
import { allowlist, type AppEnv, type Deps } from '../types.ts';
import { countUpload, MAX_PHOTO_BYTES, PhotoError, resolveUploadLink, storePhoto } from './photos.ts';
import { addPlantPhoto, countPlantPhotos, getPlantRow, MAX_PHOTOS_PER_PLANT } from './store.ts';

// /p/<token>: capability link created by Claude (add_plant / create_photo_upload_link).
// Browsers get a small form; curl (`-F photo=@file`) or a raw image body get JSON.

const wantsHtml = (c: Context) => (c.req.header('accept') ?? '').includes('text/html');

export function uploadRoutes(deps: Deps): Hono<AppEnv> {
  const { db, config } = deps;
  const isAllowed = allowlist(config);
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter(30, 3600_000);

  app.use('*', async (c, next) => {
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    await next();
  });

  const invalid = (c: Context) =>
    wantsHtml(c)
      ? c.html(
          messagePage('Lien expiré', 'Ce lien d’envoi de photo n’est plus valide. Demande un nouveau lien à Claude.'),
          404,
        )
      : c.json(
          {
            error: 'invalid_link',
            message: 'Upload link is invalid or expired; ask for a new one (create_photo_upload_link).',
          },
          404,
        );

  app.get('/:token', (c) => {
    const link = resolveUploadLink(db, c.req.param('token'), isAllowed);
    const plant = link ? getPlantRow(db, link.plantId) : undefined;
    if (!link || !plant || plant.archived_at) return invalid(c);
    return c.html(
      uploadPage({
        nickname: plant.nickname,
        commonName: plant.common_name,
        hasPhoto: plant.photo !== null,
        action: `/p/${c.req.param('token')}`,
      }),
    );
  });

  app.post(
    '/:token',
    // Cheap checks first: never read a body for an unknown link or a flooding client.
    async (c, next) => {
      if (!limiter.take(clientIp(c))) return c.json({ error: 'rate_limited', message: 'Too many uploads.' }, 429);
      const link = resolveUploadLink(db, c.req.param('token'), isAllowed);
      const plant = link ? getPlantRow(db, link.plantId) : undefined;
      if (!link || !plant || plant.archived_at) return invalid(c);
      await next();
    },
    bodyLimit({
      maxSize: MAX_PHOTO_BYTES + 64 * 1024,
      onError: (c) =>
        wantsHtml(c)
          ? c.html(messagePage('Photo trop lourde', '20 Mo maximum.'), 413)
          : c.json({ error: 'too_large', message: 'Photo too large (20 MB max).' }, 413),
    }),
    async (c) => {
      const token = c.req.param('token');
      const link = resolveUploadLink(db, token, isAllowed);
      const plant = link ? getPlantRow(db, link.plantId) : undefined;
      if (!link || !plant || plant.archived_at) return invalid(c);

      let bytes: Uint8Array | null = null;
      let note: string | null = null;
      const type = c.req.header('content-type') ?? '';
      if (type.startsWith('multipart/form-data')) {
        const form = await c.req.parseBody();
        if (typeof form.note === 'string') note = form.note;
        const file = form.photo ?? form.file;
        if (file instanceof File) bytes = new Uint8Array(await file.arrayBuffer());
      } else if (type.startsWith('image/') || type === 'application/octet-stream') {
        bytes = new Uint8Array(await c.req.arrayBuffer());
      }
      const view = { nickname: plant.nickname, commonName: plant.common_name, action: `/p/${token}` };
      try {
        if (!bytes) throw new PhotoError('Aucune image reçue (champ « photo »).');
        if (countPlantPhotos(db, plant.id) >= MAX_PHOTOS_PER_PLANT) {
          throw new PhotoError(`Limite de ${MAX_PHOTOS_PER_PLANT} photos atteinte pour cette plante.`);
        }
        const stem = await storePhoto(config.dataDir, bytes);
        addPlantPhoto(db, plant.id, stem, { userId: link.createdBy, source: 'link', note, cover: link.setCover });
        countUpload(db, link.hash);
        console.info(`photo uploaded for plant ${plant.id}`);
        return wantsHtml(c)
          ? c.html(uploadPage({ ...view, hasPhoto: true, status: { kind: 'ok' } }))
          : c.json({ ok: true, plant_id: plant.id, url: `${config.origin}/plante/${plant.id}` });
      } catch (error) {
        if (!(error instanceof PhotoError)) throw error;
        return wantsHtml(c)
          ? c.html(
              uploadPage({
                ...view,
                hasPhoto: plant.photo !== null,
                status: { kind: 'error', message: error.message },
              }),
              error.status,
            )
          : c.json({ error: 'invalid_photo', message: error.message }, error.status);
      }
    },
  );

  return app;
}
