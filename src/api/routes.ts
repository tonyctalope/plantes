import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as z from 'zod';
import type { ConnectionsResponse, MeResponse, PlantDetail, PlantsResponse, UserSettings } from '../../shared/api.ts';
import { listUsers, toUserSummary } from '../auth/users.ts';
import { isSameOrigin } from '../lib/http.ts';
import { addDays, localDate } from '../lib/time.ts';
import { listGrants, revokeGrant } from '../oauth/tokens.ts';
import { deletePhoto, MAX_PHOTO_BYTES, PhotoError, storePhoto } from '../plants/photos.ts';
import { CARE_TYPE } from '../plants/schema.ts';
import {
  addCareEvent,
  deleteCareEvent,
  deletePlant,
  getPlantRow,
  listPlantRows,
  listRooms,
  setArchived,
  setPlantPhoto,
  snoozePlant,
  toDetail,
  toSummary,
  updatePlant,
} from '../plants/store.ts';
import { countSubscriptions, deleteSubscription, isValidSubscription, saveSubscription } from '../push/push.ts';
import { getSettings, saveSettings } from '../push/reminders.ts';
import type { AppEnv, Deps } from '../types.ts';

const plantPatchSchema = z
  .object({
    nickname: z.string().trim().min(1).max(60),
    room: z.string().trim().min(1).max(60),
    notes: z.string().trim().max(2000).nullable(),
    waterIntervalGrowing: z.number().int().min(1).max(90),
    waterIntervalRest: z.number().int().min(1).max(180),
    remindersEnabled: z.boolean(),
  })
  .partial()
  .strict();

const careSchema = z
  .object({
    type: CARE_TYPE,
    note: z.string().trim().max(500).optional(),
    at: z.iso.datetime({ offset: true }).optional(),
    source: z.enum(['web', 'notification']).optional(),
  })
  .strict();

const settingsSchema = z
  .object({
    remindersEnabled: z.boolean(),
    reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();

const subscriptionSchema = z.object({
  endpoint: z.string().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

const FRENCH = z.locales.fr();

class ApiProblem extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415;
  readonly code: string;

  constructor(status: 400 | 401 | 403 | 404 | 409 | 413 | 415, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await c.req.json().catch(() => {
    throw new ApiProblem(400, 'invalid_json', 'Corps JSON invalide.');
  });
  const parsed = schema.safeParse(body, { error: FRENCH.localeError });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiProblem(400, 'invalid_request', `${issue?.path.join('.') || 'body'} : ${issue?.message}`);
  }
  return parsed.data;
}

function idParam(c: Context, name = 'id'): number {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value) || value <= 0) throw new ApiProblem(404, 'not_found', 'Plante introuvable.');
  return value;
}

export function apiRoutes(deps: Deps): Hono<AppEnv> {
  const { db, config } = deps;
  const app = new Hono<AppEnv>();
  const view = () => ({ timezone: config.timezone, growingMonths: config.growingMonths, now: deps.now() });
  const user = (c: Context<AppEnv>) => c.get('session')!.user;

  const detail = (id: number): PlantDetail => {
    const row = getPlantRow(db, id);
    if (!row) throw new ApiProblem(404, 'not_found', 'Plante introuvable.');
    return toDetail(db, row, view());
  };
  const activePlant = (id: number) => {
    const row = getPlantRow(db, id);
    if (!row) throw new ApiProblem(404, 'not_found', 'Plante introuvable.');
    if (row.archived_at) throw new ApiProblem(409, 'archived', 'Cette plante est archivée.');
    return row;
  };
  const plantsResponse = (archived: boolean): PlantsResponse => ({
    plants: listPlantRows(db, { archived }).map((row) => toSummary(row, view())),
    rooms: listRooms(db),
    today: localDate(deps.now(), config.timezone),
  });

  app.onError((error, c) => {
    if (error instanceof ApiProblem) return c.json({ error: error.code, message: error.message }, error.status);
    if (error instanceof PhotoError) return c.json({ error: 'invalid_photo', message: error.message }, error.status);
    console.error('api error:', error);
    return c.json({ error: 'server_error', message: 'Erreur interne.' }, 500);
  });

  // Every API call needs a session; state changes also need our own Origin (CSRF).
  app.use('*', async (c, next) => {
    if (!c.get('session')) return c.json({ error: 'unauthenticated', message: 'Connexion requise.' }, 401);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !isSameOrigin(c, config.origin)) {
      return c.json({ error: 'forbidden', message: 'Origine inattendue.' }, 403);
    }
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/me', (c) => {
    const me = user(c);
    const response: MeResponse = {
      user: toUserSummary(me),
      household: listUsers(db)
        .filter((member) => config.allowedEmails.has(member.email.toLowerCase()))
        .map(toUserSummary),
      settings: getSettings(db, me.id),
      push: { vapidPublicKey: deps.push.publicKey, subscriptions: countSubscriptions(db, me.id) },
      mcpUrl: config.mcpResource,
      timezone: config.timezone,
      today: localDate(deps.now(), config.timezone),
    };
    return c.json(response);
  });

  app.get('/plants', (c) => c.json(plantsResponse(c.req.query('archived') === '1')));

  app.post('/plants/water', async (c) => {
    const { ids } = await parseJson(
      c,
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }).strict(),
    );
    const unique = [...new Set(ids)];
    unique.forEach(activePlant);
    const at = deps.now().toISOString();
    for (const id of unique) addCareEvent(db, id, { type: 'water', at, userId: user(c).id, source: 'web' });
    return c.json(plantsResponse(false));
  });

  app.get('/plants/:id', (c) => c.json(detail(idParam(c))));

  app.patch('/plants/:id', async (c) => {
    const id = idParam(c);
    const patch = await parseJson(c, plantPatchSchema);
    detail(id);
    updatePlant(db, id, {
      nickname: patch.nickname,
      room: patch.room,
      water_interval_growing: patch.waterIntervalGrowing,
      water_interval_rest: patch.waterIntervalRest,
      reminders_enabled: patch.remindersEnabled,
      ...('notes' in patch ? { notes: patch.notes ?? null } : {}),
    });
    return c.json(detail(id));
  });

  app.post('/plants/:id/care', async (c) => {
    const id = idParam(c);
    const care = await parseJson(c, careSchema);
    activePlant(id);
    const now = deps.now();
    const at = care.at ? new Date(care.at) : now;
    if (at.getTime() > now.getTime() + 60_000) throw new ApiProblem(400, 'invalid_request', 'Date dans le futur.');
    addCareEvent(db, id, {
      type: care.type,
      at: at.toISOString(),
      userId: user(c).id,
      source: care.source ?? 'web',
      note: care.note ?? null,
    });
    return c.json(detail(id));
  });

  app.delete('/plants/:id/care/:eventId', (c) => {
    const id = idParam(c);
    if (!deleteCareEvent(db, id, idParam(c, 'eventId')))
      throw new ApiProblem(404, 'not_found', 'Événement introuvable.');
    return c.json(detail(id));
  });

  app.post('/plants/:id/snooze', async (c) => {
    const id = idParam(c);
    const { days } = await parseJson(c, z.object({ days: z.number().int().min(1).max(14) }).strict());
    activePlant(id);
    snoozePlant(db, id, addDays(localDate(deps.now(), config.timezone), days));
    return c.json(detail(id));
  });

  app.post('/plants/:id/archive', async (c) => {
    const id = idParam(c);
    const { reason } = await parseJson(c, z.object({ reason: z.string().trim().max(200).optional() }).strict());
    activePlant(id);
    setArchived(db, id, true, reason ?? null);
    return c.json(detail(id));
  });

  app.post('/plants/:id/unarchive', (c) => {
    const id = idParam(c);
    detail(id);
    setArchived(db, id, false);
    return c.json(detail(id));
  });

  app.delete('/plants/:id', async (c) => {
    const { deleted, photo } = deletePlant(db, idParam(c));
    if (!deleted) throw new ApiProblem(404, 'not_found', 'Plante introuvable.');
    await deletePhoto(config.dataDir, photo);
    console.info(`plant ${c.req.param('id')} deleted by ${user(c).email}`);
    return c.body(null, 204);
  });

  app.post(
    '/plants/:id/photo',
    bodyLimit({
      maxSize: MAX_PHOTO_BYTES + 64 * 1024,
      onError: (c) => c.json({ error: 'too_large', message: 'Photo trop lourde (20 Mo maximum).' }, 413),
    }),
    async (c) => {
      const id = idParam(c);
      activePlant(id);
      const form = await c.req.parseBody();
      const file = form.photo;
      if (!(file instanceof File)) throw new ApiProblem(400, 'invalid_request', 'Champ « photo » manquant.');
      const stem = await storePhoto(config.dataDir, new Uint8Array(await file.arrayBuffer()));
      const previous = setPlantPhoto(db, id, stem);
      await deletePhoto(config.dataDir, previous);
      return c.json(detail(id));
    },
  );

  app.put('/settings', async (c) => {
    const settings: UserSettings = await parseJson(c, settingsSchema);
    return c.json(saveSettings(db, user(c).id, settings));
  });

  app.post('/push/subscriptions', async (c) => {
    const subscription = await parseJson(c, subscriptionSchema);
    if (!isValidSubscription(subscription)) {
      throw new ApiProblem(400, 'invalid_subscription', 'Abonnement push non reconnu.');
    }
    saveSubscription(db, user(c).id, subscription, c.req.header('user-agent') ?? null);
    getSettings(db, user(c).id);
    return c.body(null, 204);
  });

  app.delete('/push/subscriptions', async (c) => {
    const { endpoint } = await parseJson(c, z.object({ endpoint: z.string().max(1000) }));
    deleteSubscription(db, user(c).id, endpoint);
    return c.body(null, 204);
  });

  app.post('/push/test', async (c) => {
    const sent = await deps.push.sendToUser(user(c).id, {
      title: '🌿 Ça marche !',
      body: 'Les rappels d’arrosage arriveront ici.',
      url: '/reglages',
      tag: 'plantes-test',
    });
    return c.json({ sent });
  });

  app.get('/connections', (c) => {
    const response: ConnectionsResponse = { connections: listGrants(db, user(c).id) };
    return c.json(response);
  });

  app.delete('/connections/:id', (c) => {
    const id = c.req.param('id');
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(id) || !revokeGrant(db, id, user(c).id)) {
      throw new ApiProblem(404, 'not_found', 'Connexion introuvable.');
    }
    return c.body(null, 204);
  });

  app.all('*', (c) => c.json({ error: 'not_found', message: 'Route inconnue.' }, 404));

  return app;
}
