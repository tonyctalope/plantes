import { McpServer, type AuthInfo, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { PlantSummary } from '../../shared/api.ts';
import { get } from '../db/database.ts';
import { addDays, isIsoDate, localDate, localTime } from '../lib/time.ts';
import { createUploadLink, readThumbnail, UPLOAD_LINK_TTL_MS, UploadLinkLimitError } from '../plants/photos.ts';
import { seasonOf } from '../plants/schedule.ts';
import {
  CARE_TYPE,
  careDetailsSchema,
  householdFieldsShape,
  plantFieldsSchema,
  plantFieldsShape,
} from '../plants/schema.ts';
import {
  addCareEvent,
  createPlant,
  getPlantRow,
  listEvents,
  listPlantRows,
  listRooms,
  setArchived,
  snoozePlant,
  toDetail,
  toSummary,
  updatePlant,
  type ViewContext,
} from '../plants/store.ts';
import type { Deps } from '../types.ts';

const VERSION = '1.1.0';

const DETAILS_DESCRIPTION =
  'Structured, SHORT facts shown as tiles and pills in the app (2–6 words per item, no sentences except key_tips). Fill as many as you can: this is what the household reads first; the long text fields are only the "details" behind it.';
const MAX_ACTIVE_PLANTS = 300;
const MAX_PLANTS = 1000;
/** Care events a single plant may receive per 24 h (a household waters a plant a few times a day at most). */
const MAX_EVENTS_PER_DAY = 30;

export interface McpCaller {
  userId: number;
  email: string;
  clientName: string;
}

export function callerFromAuth(auth: AuthInfo | undefined): McpCaller | null {
  const extra = auth?.extra;
  if (!extra || typeof extra.userId !== 'number' || typeof extra.email !== 'string') return null;
  return { userId: extra.userId, email: extra.email, clientName: String(extra.clientName ?? 'Claude') };
}

function instructions(deps: Deps, today: string): string {
  const { config } = deps;
  const season = seasonOf(today, config.growingMonths) === 'growing' ? 'growing season' : 'rest period';
  const months = `${config.growingMonths.from}–${config.growingMonths.to}`;
  return [
    `Plantes is the plant-care tracker of one household; everyone who reaches this server is a member of it. Today is ${today} (${config.timezone}), ${season} (growing season = months ${months}).`,
    'Language: the household speaks French. Write every free-text value (names, notes, care advice) in French.',
    '',
    'Adding a plant (plants are only ever added through you):',
    '1. The user usually sends a photo. Identify the plant as precisely as possible (genus, species, cultivar when visible). If you are not reasonably sure, give the likely candidates and ask for another photo (whole plant, leaf close-up, underside, flowers) before adding.',
    '2. Call list_plants first to avoid duplicates and to reuse the existing room names.',
    "3. If you don't know where the plant lives (room, window orientation, distance to the window), ask briefly: light and watering advice depend on it. If the user doesn't know, assume and say so.",
    '4. Call add_plant with a complete care sheet adapted to indoor life in this home. Watering intervals are reminder cadences: pick realistic values for this plant in its current pot, separately for the growing season and the rest period, and tell the user they can adjust them in the app.',
    '4b. Always fill `details` (short pills: light_good / light_avoid, watering_rule, watering_tips, thirst_signs / overwatering_signs, soil_mix, fertilizer_*, repotting_*, problems as symptom → cause, key_tips, pet_risk). Keep the long text fields to 1–3 sentences: they are only shown on demand.',
    '5. Attach the photo: add_plant returns photo_upload_url. If you can read the image file yourself (Claude Code: the local file path; a code sandbox where the upload lives, e.g. /mnt/user-data/uploads/…), upload it with: curl -fsS -F "photo=@<file>" "<photo_upload_url>". Otherwise give the user the link: it opens a page where they pick the photo (valid 24 h).',
    '',
    'Photos: each plant has a photo journal for following its growth. To add another photo later, call create_photo_upload_link (the photo is added to the journal; set_as_cover makes it the main photo). get_plant with recent_photos shows you the latest photos with their dates to compare and diagnose.',
    'Watering: when someone says they watered, call log_care (type "water", several plant ids at once is fine). "Qu\'est-ce que je dois arroser ?" → get_due_plants. If the soil is still moist, snooze_watering instead of logging a watering.',
    'Never invent a watering that did not happen; ask when unsure which plants were watered.',
    config.householdContext ? `\nHousehold context: ${config.householdContext}` : '',
  ]
    .join('\n')
    .trim();
}

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function json(value: unknown): CallToolResult {
  return text(JSON.stringify(value, null, 1));
}

/** ISO timestamp for "watered on <date>" (local noon) or a full timestamp; null if invalid or in the future. */
function careTimestamp(value: string | undefined, now: Date, timeZone: string): string | null {
  if (!value) return now.toISOString();
  let at: Date;
  if (isIsoDate(value)) {
    const guess = new Date(`${value}T12:00:00Z`);
    const [hours, minutes] = localTime(guess, timeZone).split(':').map(Number) as [number, number];
    at = new Date(guess.getTime() - (hours * 60 + minutes - 12 * 60) * 60_000);
    if (localDate(at, timeZone) === localDate(now, timeZone) && at > now) at = now;
  } else {
    at = new Date(value);
  }
  if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 60_000) return null;
  return at.toISOString();
}

function brief(plant: PlantSummary, origin: string) {
  return {
    id: plant.id,
    nickname: plant.nickname,
    common_name: plant.commonName,
    scientific_name: plant.scientificName,
    room: plant.room,
    has_photo: plant.photo !== null,
    reminders_enabled: plant.remindersEnabled,
    toxicity_pets: plant.toxicityPets,
    last_watered_at: plant.water.lastWateredAt,
    last_watered_by: plant.water.lastWateredBy,
    next_watering: plant.water.dueDate,
    days_until_watering: plant.water.daysUntilDue,
    watering_state: plant.water.state,
    interval_days_now: plant.water.intervalDays,
    archived_at: plant.archivedAt ?? undefined,
    url: `${origin}/plante/${plant.id}`,
  };
}

export function buildMcpServer(deps: Deps, caller: McpCaller): McpServer {
  const { db, config } = deps;
  const view = (): ViewContext => ({ timezone: config.timezone, growingMonths: config.growingMonths, now: deps.now() });
  const today = localDate(deps.now(), config.timezone);
  const server = new McpServer(
    { name: 'plantes', title: 'Plantes', version: VERSION },
    { instructions: instructions(deps, today) },
  );
  const plantUrl = (id: number) => `${config.origin}/plante/${id}`;
  const findActive = (id: number) => {
    const row = getPlantRow(db, id);
    return row && !row.archived_at ? row : null;
  };
  const uploadInstructions = (plantId: number, setCover: boolean) => {
    let link;
    try {
      link = createUploadLink(db, plantId, caller.userId, { setCover });
    } catch (error) {
      if (!(error instanceof UploadLinkLimitError)) throw error;
      return { text: 'No photo link available right now (too many live links); try create_photo_upload_link later.' };
    }
    const { token, expiresAt } = link;
    const url = `${config.origin}/p/${token}`;
    return {
      text: [
        `photo_upload_url: ${url}  (valid until ${expiresAt}, up to 10 uploads)`,
        `- You can read the image file (Claude Code path, sandbox upload…): curl -fsS -F "photo=@<file>" "${url}"`,
        `- Otherwise give the user this link to tap; it opens a page where they choose the photo.`,
      ].join('\n'),
    };
  };

  server.registerTool(
    'list_plants',
    {
      title: 'Lister les plantes',
      description:
        'List the household plants with their room and watering status. Call before add_plant (duplicates, room names).',
      inputSchema: z.object({
        room: z.string().trim().max(60).optional().describe('Only plants in this room (case-insensitive).'),
        include_archived: z.boolean().optional().describe('Also list archived plants (dead, given away…).'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ room, include_archived }) => {
      const rows = listPlantRows(db, { archived: include_archived ? 'all' : false });
      const plants = rows
        .filter((row) => !room || row.room.toLowerCase() === room.toLowerCase())
        .map((row) => brief(toSummary(row, view()), config.origin));
      return json({ today, rooms: listRooms(db), count: plants.length, plants });
    },
  );

  server.registerTool(
    'get_plant',
    {
      title: 'Fiche d’une plante',
      description:
        'Full care sheet, household notes, recent care history and photo journal of one plant. include_photo returns its main photo; recent_photos returns the latest journal photos (newest first, with dates) so you can follow its growth or diagnose a problem.',
      inputSchema: z.object({
        plant_id: z.number().int().positive(),
        include_photo: z.boolean().optional().describe('Return the main photo.'),
        recent_photos: z.number().int().min(0).max(4).optional().describe('Also return the N latest journal photos.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ plant_id, include_photo, recent_photos = 0 }) => {
      const row = getPlantRow(db, plant_id);
      if (!row) return text(`No plant with id ${plant_id}. Call list_plants.`, true);
      const detail = toDetail(db, row, view());
      const result = json({
        ...brief(detail, config.origin),
        care_sheet: detail.care,
        notes: detail.notes,
        created_at: detail.createdAt,
        created_by: detail.createdBy,
        last_fertilized_at: detail.lastFertilizedAt,
        recent_events: listEvents(db, plant_id, 15),
        photo_journal: detail.photos.map((photo) => ({
          id: photo.id,
          taken_at: photo.takenAt,
          by: photo.by,
          note: photo.note,
          is_main: photo.isCover,
        })),
      });
      if (include_photo && row.photo) {
        const data = await readThumbnail(config.dataDir, row.photo);
        if (data) {
          result.content.push({ type: 'text', text: 'Main photo:' });
          result.content.push({ type: 'image', data, mimeType: 'image/webp' });
        }
      } else if (include_photo) {
        result.content.push({ type: 'text', text: 'This plant has no photo yet (create_photo_upload_link).' });
      }
      for (const photo of detail.photos.slice(0, recent_photos)) {
        const stem = /\/photos\/([A-Za-z0-9_-]{22})-thumb\.webp$/.exec(photo.thumb)?.[1];
        const data = stem ? await readThumbnail(config.dataDir, stem) : null;
        if (!data) continue;
        result.content.push({
          type: 'text',
          text: `Journal photo #${photo.id}, ${photo.takenAt}${photo.note ? ` — ${photo.note}` : ''}:`,
        });
        result.content.push({ type: 'image', data, mimeType: 'image/webp' });
      }
      return result;
    },
  );

  server.registerTool(
    'add_plant',
    {
      title: 'Ajouter une plante',
      description:
        'Add a plant with a complete care sheet, after identifying it (usually from a photo the user sent). Returns its id, page URL and a photo upload link: attach the photo right after (see the server instructions).',
      inputSchema: plantFieldsSchema.extend({
        notes: z.string().trim().max(2000).optional().describe('Household notes (origin, gift from…, quirks).'),
        details: careDetailsSchema.optional().describe(DETAILS_DESCRIPTION),
        last_watered: z
          .string()
          .optional()
          .describe('When it was last watered, only if the user said so: YYYY-MM-DD or an ISO timestamp.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      const { notes, last_watered, details, ...fields } = input;
      const counts = get<{ active: number; total: number }>(
        db,
        'SELECT COUNT(*) FILTER (WHERE archived_at IS NULL) AS active, COUNT(*) AS total FROM plants',
      )!;
      if (counts.active >= MAX_ACTIVE_PLANTS || counts.total >= MAX_PLANTS) {
        return text(
          `The collection is full (${counts.active} active / ${counts.total} total, max ${MAX_ACTIVE_PLANTS} / ${MAX_PLANTS}).`,
          true,
        );
      }
      const duplicate = get<{ id: number }>(
        db,
        'SELECT id FROM plants WHERE archived_at IS NULL AND nickname = :nickname COLLATE NOCASE',
        { nickname: fields.nickname },
      );
      if (duplicate) {
        return text(
          `A plant is already called "${fields.nickname}" (id ${duplicate.id}). Use update_plant for it, or pick another nickname.`,
          true,
        );
      }
      if (fields.temp_min_c !== undefined && fields.temp_max_c !== undefined && fields.temp_min_c > fields.temp_max_c) {
        return text('temp_min_c must be lower than temp_max_c.', true);
      }
      const lastWateredAt = last_watered ? careTimestamp(last_watered, deps.now(), config.timezone) : null;
      if (last_watered && !lastWateredAt)
        return text('last_watered must be a past date (YYYY-MM-DD) or ISO timestamp.', true);
      const id = createPlant(
        db,
        { ...fields, notes: notes ?? null, ...(details ? { details } : {}) },
        {
          userId: caller.userId,
          via: caller.clientName,
          lastWateredAt,
        },
      );
      const plant = toSummary(getPlantRow(db, id)!, view());
      const upload = uploadInstructions(id, true);
      console.info(`mcp: ${caller.email} added plant ${id} (${fields.scientific_name}) via ${caller.clientName}`);
      return text(
        [
          `Added plant #${id} "${plant.nickname}" (${plant.scientificName}) in ${plant.room}.`,
          `Next watering: ${plant.water.dueDate} (every ${fields.water_interval_growing} days in the growing season, ${fields.water_interval_rest} in the rest period).`,
          `Page: ${plantUrl(id)}`,
          '',
          'PHOTO — attach it now:',
          upload.text,
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'update_plant',
    {
      title: 'Modifier une plante',
      description:
        'Change any field of a plant (care sheet, room, nickname, intervals, notes, reminders). Only the fields you pass are changed.',
      inputSchema: z.object({
        plant_id: z.number().int().positive(),
        ...Object.fromEntries(Object.entries(plantFieldsShape).map(([key, schema]) => [key, schema.optional()])),
        ...householdFieldsShape,
        details: careDetailsSchema
          .optional()
          .describe(`${DETAILS_DESCRIPTION} Merged: the keys you pass replace the stored ones, the others stay.`),
      }) as unknown as z.ZodObject<
        { plant_id: z.ZodNumber } & {
          [K in keyof typeof plantFieldsShape]: z.ZodOptional<(typeof plantFieldsShape)[K]>;
        } & typeof householdFieldsShape & { details: z.ZodOptional<typeof careDetailsSchema> }
      >,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ plant_id, ...patch }) => {
      const row = getPlantRow(db, plant_id);
      if (!row) return text(`No plant with id ${plant_id}.`, true);
      if (patch.nickname) {
        const duplicate = get<{ id: number }>(
          db,
          'SELECT id FROM plants WHERE archived_at IS NULL AND nickname = :nickname COLLATE NOCASE AND id != :id',
          { nickname: patch.nickname, id: plant_id },
        );
        if (duplicate) return text(`Another plant (id ${duplicate.id}) is already called "${patch.nickname}".`, true);
      }
      updatePlant(db, plant_id, patch);
      const plant = toSummary(getPlantRow(db, plant_id)!, view());
      return json({ updated: Object.keys(patch), plant: brief(plant, config.origin) });
    },
  );

  server.registerTool(
    'log_care',
    {
      title: 'Noter un arrosage / soin',
      description:
        'Record that plants were watered (default) or got another care (fertilize, repot, prune, treat, mist, note), now or at a past date. Watering resets the reminder.',
      inputSchema: z.object({
        plant_ids: z.array(z.number().int().positive()).min(1).max(100),
        type: CARE_TYPE.optional().describe('Default "water".'),
        date: z.string().optional().describe('YYYY-MM-DD or ISO timestamp in the past; default now.'),
        note: z.string().trim().max(500).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ plant_ids, type = 'water', date, note }) => {
      const at = careTimestamp(date, deps.now(), config.timezone);
      if (!at) return text('date must be a past YYYY-MM-DD date or ISO timestamp.', true);
      const unknown = plant_ids.filter((id) => !findActive(id));
      if (unknown.length)
        return text(`Unknown or archived plant ids: ${unknown.join(', ')}. Nothing was recorded.`, true);
      const since = new Date(deps.now().getTime() - 24 * 3600 * 1000).toISOString();
      const busy = [...new Set(plant_ids)].filter(
        (id) =>
          (get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM care_events WHERE plant_id = :id AND at >= :since', {
            id,
            since,
          })?.n ?? 0) >= MAX_EVENTS_PER_DAY,
      );
      if (busy.length) return text(`Too many care events in 24 h for plant ids: ${busy.join(', ')}.`, true);
      for (const id of new Set(plant_ids)) {
        addCareEvent(db, id, { type, at, userId: caller.userId, source: 'mcp', note: note ?? null });
      }
      const plants = [...new Set(plant_ids)].map((id) => brief(toSummary(getPlantRow(db, id)!, view()), config.origin));
      return json({ recorded: type, at, plants });
    },
  );

  server.registerTool(
    'get_due_plants',
    {
      title: 'Plantes à arroser',
      description: 'Plants that need water today (or are overdue), optionally including the next few days.',
      inputSchema: z.object({
        within_days: z.number().int().min(0).max(30).optional().describe('Also include plants due in the next N days.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ within_days = 0 }) => {
      const plants = listPlantRows(db)
        .map((row) => toSummary(row, view()))
        .filter((plant) => plant.water.daysUntilDue <= within_days)
        .sort((a, b) => a.water.daysUntilDue - b.water.daysUntilDue)
        .map((plant) => ({ ...brief(plant, config.origin), reminders_enabled: plant.remindersEnabled }));
      return json({ today, within_days, count: plants.length, plants });
    },
  );

  server.registerTool(
    'snooze_watering',
    {
      title: 'Reporter un arrosage',
      description: 'Postpone the next watering reminder by a few days (soil still moist). Does not log a watering.',
      inputSchema: z.object({
        plant_ids: z.array(z.number().int().positive()).min(1).max(100),
        days: z.number().int().min(1).max(14),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ plant_ids, days }) => {
      const unknown = plant_ids.filter((id) => !findActive(id));
      if (unknown.length) return text(`Unknown or archived plant ids: ${unknown.join(', ')}.`, true);
      const until = addDays(localDate(deps.now(), config.timezone), days);
      for (const id of plant_ids) snoozePlant(db, id, until);
      const plants = plant_ids.map((id) => brief(toSummary(getPlantRow(db, id)!, view()), config.origin));
      return json({ snoozed_until: until, plants });
    },
  );

  server.registerTool(
    'create_photo_upload_link',
    {
      title: 'Lien d’envoi de photo',
      description:
        "New link to add a photo to a plant's photo journal (valid 24 h). The photo becomes the main photo if set_as_cover is true or the plant has none.",
      inputSchema: z.object({
        plant_id: z.number().int().positive(),
        set_as_cover: z
          .boolean()
          .optional()
          .describe('Make the uploaded photo the main photo (default: only if it has none).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ plant_id, set_as_cover }) => {
      const row = findActive(plant_id);
      if (!row) return text(`No active plant with id ${plant_id}.`, true);
      const upload = uploadInstructions(plant_id, set_as_cover ?? false);
      return text(
        `Photo link for #${plant_id} "${row.nickname}" (valid ${UPLOAD_LINK_TTL_MS / 3600_000} h):\n${upload.text}`,
      );
    },
  );

  server.registerTool(
    'archive_plant',
    {
      title: 'Archiver une plante',
      description:
        'Archive a plant that died or left the home (no more reminders; it can be restored from the app). Confirm with the user first.',
      inputSchema: z.object({
        plant_id: z.number().int().positive(),
        reason: z.string().trim().max(200).optional().describe('e.g. "morte", "donnée à …".'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ plant_id, reason }) => {
      const row = findActive(plant_id);
      if (!row) return text(`No active plant with id ${plant_id}.`, true);
      setArchived(db, plant_id, true, reason ?? null);
      return text(`Archived #${plant_id} "${row.nickname}". It can be restored from the app (Réglages → Archives).`);
    },
  );

  server.registerPrompt(
    'ajouter_une_plante',
    {
      title: 'Ajouter une plante depuis une photo',
      description: 'Identify a plant from a photo and add it with a full care sheet.',
      argsSchema: z.object({
        piece: z.string().max(60).optional().describe('Pièce où vit la plante'),
      }),
    },
    async ({ piece }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Je t'envoie une photo d'une plante à ajouter${piece ? ` (elle est dans : ${piece})` : ''}. Identifie-la précisément, vérifie les doublons avec list_plants, ajoute-la avec add_plant (fiche complète en français) puis attache la photo.`,
          },
        },
      ],
    }),
  );

  return server;
}
