import type {
  CareDetails,
  CareEvent,
  CareSheet,
  CareSource,
  CareType,
  Confidence,
  Difficulty,
  Humidity,
  Light,
  PlantDetail,
  PlantPhoto,
  PlantSummary,
  Toxicity,
} from '../../shared/api.ts';
import { all, bool, get, run, transaction, type Db, type Params } from '../db/database.ts';
import { displayName } from '../auth/users.ts';
import { computeWaterStatus, type GrowingMonths } from './schedule.ts';
import {
  careDetailsSchema,
  PLANT_COLUMNS,
  type CareDetailsInput,
  type PlantFields,
  type PlantFieldsPatch,
} from './schema.ts';

export interface PlantRow {
  id: number;
  nickname: string;
  common_name: string;
  scientific_name: string;
  family: string | null;
  identification_confidence: Confidence;
  identification_notes: string | null;
  room: string;
  indoor: number;
  light: Light;
  light_notes: string | null;
  water_interval_growing: number;
  water_interval_rest: number;
  watering_instructions: string;
  water_amount: string | null;
  humidity: Humidity | null;
  humidity_notes: string | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  temperature_notes: string | null;
  soil: string | null;
  fertilizing: string | null;
  repotting: string | null;
  pruning: string | null;
  toxicity_pets: Toxicity;
  toxicity_notes: string | null;
  difficulty: Difficulty | null;
  common_problems: string | null;
  tips: string | null;
  pot: string | null;
  notes: string | null;
  reminders_enabled: number;
  snoozed_until: string | null;
  photo: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  created_via: string;
  // joined
  last_water_at: string | null;
  last_water_by_name: string | null;
  last_water_by_email: string | null;
  last_fertilize_at: string | null;
  creator_name: string | null;
  creator_email: string | null;
  care_details: string | null;
  photo_count: number;
}

interface EventRow {
  id: number;
  plant_id: number;
  type: CareType;
  at: string;
  user_id: number | null;
  source: CareSource;
  note: string | null;
  user_name: string | null;
  user_email: string | null;
}

export interface ViewContext {
  timezone: string;
  growingMonths: GrowingMonths;
  now: Date;
}

const SELECT_PLANT = `
  SELECT p.*,
    lw.at AS last_water_at, lu.name AS last_water_by_name, lu.email AS last_water_by_email,
    (SELECT MAX(f.at) FROM care_events f WHERE f.plant_id = p.id AND f.type = 'fertilize') AS last_fertilize_at,
    cu.name AS creator_name, cu.email AS creator_email,
    (SELECT COUNT(*) FROM plant_photos pp WHERE pp.plant_id = p.id) AS photo_count
  FROM plants p
  LEFT JOIN care_events lw ON lw.id = (
    SELECT e.id FROM care_events e WHERE e.plant_id = p.id AND e.type = 'water' ORDER BY e.at DESC, e.id DESC LIMIT 1)
  LEFT JOIN users lu ON lu.id = lw.user_id
  LEFT JOIN users cu ON cu.id = p.created_by`;

const ORDER = 'ORDER BY p.room COLLATE NOCASE, p.nickname COLLATE NOCASE, p.id';

function nameOf(name: string | null, email: string | null): string | null {
  return email ? displayName({ name, email }) : null;
}

function fieldParams(fields: PlantFieldsPatch): Params {
  const params: Params = {};
  for (const column of PLANT_COLUMNS) {
    const value = fields[column];
    if (value === undefined) continue; // absent = unchanged
    params[column] = typeof value === 'boolean' ? bool(value) : value;
  }
  return params;
}

export function createPlant(
  db: Db,
  fields: PlantFields & { notes?: string | null; details?: CareDetailsInput },
  meta: { userId: number | null; via: string; lastWateredAt?: string | null },
): number {
  return transaction(db, () => {
    const now = new Date().toISOString();
    const params = fieldParams(fields);
    for (const column of PLANT_COLUMNS) if (!(column in params)) params[column] = null;
    const columns = [
      ...PLANT_COLUMNS,
      'notes',
      'care_details',
      'created_at',
      'updated_at',
      'created_by',
      'created_via',
    ];
    const { lastInsertRowid } = run(
      db,
      `INSERT INTO plants (${columns.join(', ')}) VALUES (${columns.map((c) => `:${c}`).join(', ')})`,
      {
        ...params,
        notes: fields.notes ?? null,
        care_details: fields.details ? JSON.stringify(fields.details) : null,
        created_at: now,
        updated_at: now,
        created_by: meta.userId,
        created_via: meta.via.slice(0, 80),
      },
    );
    if (meta.lastWateredAt) {
      addCareEvent(db, lastInsertRowid, {
        type: 'water',
        at: meta.lastWateredAt,
        userId: meta.userId,
        source: 'mcp',
        note: "Indiqué à l'ajout de la plante",
      });
    }
    return lastInsertRowid;
  });
}

export function getPlantRow(db: Db, id: number): PlantRow | undefined {
  return get<PlantRow>(db, `${SELECT_PLANT} WHERE p.id = :id`, { id });
}

export function listPlantRows(db: Db, filter: { archived: boolean | 'all' } = { archived: false }): PlantRow[] {
  const where =
    filter.archived === 'all'
      ? ''
      : filter.archived
        ? 'WHERE p.archived_at IS NOT NULL'
        : 'WHERE p.archived_at IS NULL';
  return all<PlantRow>(db, `${SELECT_PLANT} ${where} ${ORDER}`);
}

export function updatePlant(
  db: Db,
  id: number,
  patch: PlantFieldsPatch & { notes?: string | null; reminders_enabled?: boolean; details?: CareDetailsInput },
): boolean {
  const params = fieldParams(patch);
  const sets = Object.keys(params).map((column) => `${column} = :${column}`);
  if ('notes' in patch) {
    sets.push('notes = :notes');
    params.notes = patch.notes ?? null;
  }
  if (patch.reminders_enabled !== undefined) {
    sets.push('reminders_enabled = :reminders_enabled');
    params.reminders_enabled = bool(patch.reminders_enabled);
  }
  if (patch.details) {
    // Merge: the keys passed replace the stored ones, the others stay.
    const current = get<{ care_details: string | null }>(db, 'SELECT care_details FROM plants WHERE id = :id', { id });
    const merged = { ...readDetails(current?.care_details ?? null), ...patch.details };
    sets.push('care_details = :care_details');
    params.care_details = JSON.stringify(merged);
  }
  if (sets.length === 0) return Boolean(getPlantRow(db, id));
  const { changes } = run(db, `UPDATE plants SET ${sets.join(', ')}, updated_at = :updated_at WHERE id = :id`, {
    ...params,
    updated_at: new Date().toISOString(),
    id,
  });
  return changes === 1;
}

export function addCareEvent(
  db: Db,
  plantId: number,
  event: { type: CareType; at: string; userId: number | null; source: CareSource; note?: string | null },
): number {
  return transaction(db, () => {
    const { lastInsertRowid } = run(
      db,
      `INSERT INTO care_events (plant_id, type, at, user_id, source, note) VALUES (:plant, :type, :at, :user, :source, :note)`,
      {
        plant: plantId,
        type: event.type,
        at: event.at,
        user: event.userId,
        source: event.source,
        note: event.note?.trim() ? event.note.trim().slice(0, 500) : null,
      },
    );
    if (event.type === 'water') {
      run(db, 'UPDATE plants SET snoozed_until = NULL WHERE id = :id', { id: plantId });
    }
    return lastInsertRowid;
  });
}

export function deleteCareEvent(db: Db, plantId: number, eventId: number): boolean {
  return (
    run(db, 'DELETE FROM care_events WHERE id = :id AND plant_id = :plant', { id: eventId, plant: plantId }).changes ===
    1
  );
}

export function listEvents(db: Db, plantId: number, limit = 50): CareEvent[] {
  const rows = all<EventRow>(
    db,
    `SELECT e.*, u.name AS user_name, u.email AS user_email FROM care_events e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.plant_id = :plant ORDER BY e.at DESC, e.id DESC LIMIT :limit`,
    { plant: plantId, limit },
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    at: row.at,
    by: nameOf(row.user_name, row.user_email),
    source: row.source,
    note: row.note,
  }));
}

export function snoozePlant(db: Db, id: number, until: string): boolean {
  return run(db, 'UPDATE plants SET snoozed_until = :until WHERE id = :id', { until, id }).changes === 1;
}

export function setArchived(db: Db, id: number, archived: boolean, reason: string | null = null): boolean {
  const now = new Date().toISOString();
  return (
    run(db, 'UPDATE plants SET archived_at = :at, archive_reason = :reason, updated_at = :now WHERE id = :id', {
      at: archived ? now : null,
      reason: archived ? (reason?.trim().slice(0, 200) ?? null) : null,
      now,
      id,
    }).changes === 1
  );
}

/** Deletes the plant and returns the stems of all its photos (to delete the files). */
export function deletePlant(db: Db, id: number): { deleted: boolean; photos: string[] } {
  return transaction(db, () => {
    const row = get<{ photo: string | null }>(db, 'SELECT photo FROM plants WHERE id = :id', { id });
    if (!row) return { deleted: false, photos: [] };
    const stems = all<{ stem: string }>(db, 'SELECT stem FROM plant_photos WHERE plant_id = :id', { id }).map(
      (photo) => photo.stem,
    );
    if (row.photo && !stems.includes(row.photo)) stems.push(row.photo);
    run(db, 'DELETE FROM plants WHERE id = :id', { id });
    return { deleted: true, photos: stems };
  });
}

// --- photo journal (plants.photo = stem of the main photo)

export const MAX_PHOTOS_PER_PLANT = 200;

export function countPlantPhotos(db: Db, plantId: number): number {
  return get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM plant_photos WHERE plant_id = :id', { id: plantId })?.n ?? 0;
}

/** Adds a photo to the journal; it becomes the main photo when asked or when the plant has none. */
export function addPlantPhoto(
  db: Db,
  plantId: number,
  stem: string,
  meta: { userId: number | null; source: 'web' | 'link'; note?: string | null; cover?: boolean },
): number {
  return transaction(db, () => {
    const now = new Date().toISOString();
    const { lastInsertRowid } = run(
      db,
      `INSERT INTO plant_photos (plant_id, stem, taken_at, user_id, source, note) VALUES (:plant, :stem, :at, :user, :source, :note)`,
      {
        plant: plantId,
        stem,
        at: now,
        user: meta.userId,
        source: meta.source,
        note: meta.note?.trim() ? meta.note.trim().slice(0, 300) : null,
      },
    );
    run(
      db,
      `UPDATE plants SET photo = CASE WHEN :cover = 1 OR photo IS NULL THEN :stem ELSE photo END, updated_at = :now
        WHERE id = :plant`,
      { cover: meta.cover ? 1 : 0, stem, now, plant: plantId },
    );
    return lastInsertRowid;
  });
}

interface PhotoRow {
  id: number;
  stem: string;
  taken_at: string;
  source: 'web' | 'link';
  note: string | null;
  user_name: string | null;
  user_email: string | null;
}

export function listPlantPhotos(db: Db, plantId: number, cover: string | null): PlantPhoto[] {
  return all<PhotoRow>(
    db,
    `SELECT ph.id, ph.stem, ph.taken_at, ph.source, ph.note, u.name AS user_name, u.email AS user_email
       FROM plant_photos ph LEFT JOIN users u ON u.id = ph.user_id
      WHERE ph.plant_id = :plant ORDER BY ph.taken_at DESC, ph.id DESC`,
    { plant: plantId },
  ).map((row) => ({
    id: row.id,
    ...photoUrls(row.stem)!,
    takenAt: row.taken_at,
    by: nameOf(row.user_name, row.user_email),
    note: row.note,
    isCover: row.stem === cover,
    source: row.source,
  }));
}

export function setCoverPhoto(db: Db, plantId: number, photoId: number): boolean {
  const row = get<{ stem: string }>(db, 'SELECT stem FROM plant_photos WHERE id = :id AND plant_id = :plant', {
    id: photoId,
    plant: plantId,
  });
  if (!row) return false;
  run(db, 'UPDATE plants SET photo = :stem, updated_at = :now WHERE id = :plant', {
    stem: row.stem,
    now: new Date().toISOString(),
    plant: plantId,
  });
  return true;
}

export function setPhotoNote(db: Db, plantId: number, photoId: number, note: string | null): boolean {
  return (
    run(db, 'UPDATE plant_photos SET note = :note WHERE id = :id AND plant_id = :plant', {
      note: note?.trim() ? note.trim().slice(0, 300) : null,
      id: photoId,
      plant: plantId,
    }).changes === 1
  );
}

/** Removes a journal photo; returns its stem (files to delete). The newest remaining photo becomes main. */
export function removePlantPhoto(db: Db, plantId: number, photoId: number): string | null {
  return transaction(db, () => {
    const row = get<{ stem: string }>(db, 'SELECT stem FROM plant_photos WHERE id = :id AND plant_id = :plant', {
      id: photoId,
      plant: plantId,
    });
    if (!row) return null;
    run(db, 'DELETE FROM plant_photos WHERE id = :id', { id: photoId });
    const plant = get<{ photo: string | null }>(db, 'SELECT photo FROM plants WHERE id = :id', { id: plantId });
    if (plant?.photo === row.stem) {
      const next = get<{ stem: string }>(
        db,
        'SELECT stem FROM plant_photos WHERE plant_id = :plant ORDER BY taken_at DESC, id DESC LIMIT 1',
        { plant: plantId },
      );
      run(db, 'UPDATE plants SET photo = :stem WHERE id = :plant', { stem: next?.stem ?? null, plant: plantId });
    }
    return row.stem;
  });
}

export function listRooms(db: Db): string[] {
  return all<{ room: string }>(
    db,
    'SELECT DISTINCT room FROM plants WHERE archived_at IS NULL ORDER BY room COLLATE NOCASE',
  ).map((row) => row.room);
}

export function photoUrls(stem: string | null): { thumb: string; full: string } | null {
  return stem ? { thumb: `/photos/${stem}-thumb.webp`, full: `/photos/${stem}.webp` } : null;
}

export function toSummary(row: PlantRow, view: ViewContext): PlantSummary {
  return {
    id: row.id,
    nickname: row.nickname,
    commonName: row.common_name,
    scientificName: row.scientific_name,
    room: row.room,
    photo: photoUrls(row.photo),
    remindersEnabled: row.reminders_enabled === 1,
    toxicityPets: row.toxicity_pets,
    archivedAt: row.archived_at,
    archiveReason: row.archive_reason,
    photoCount: row.photo_count,
    water: computeWaterStatus(
      {
        createdAt: row.created_at,
        lastWateredAt: row.last_water_at,
        lastWateredBy: nameOf(row.last_water_by_name, row.last_water_by_email),
        intervalGrowing: row.water_interval_growing,
        intervalRest: row.water_interval_rest,
        snoozedUntil: row.snoozed_until,
      },
      view.now,
      view.timezone,
      view.growingMonths,
    ),
  };
}

export function careSheet(row: PlantRow): CareSheet {
  return {
    family: row.family,
    identificationConfidence: row.identification_confidence,
    identificationNotes: row.identification_notes,
    indoor: row.indoor === 1,
    light: row.light,
    lightNotes: row.light_notes,
    waterIntervalGrowing: row.water_interval_growing,
    waterIntervalRest: row.water_interval_rest,
    wateringInstructions: row.watering_instructions,
    waterAmount: row.water_amount,
    humidity: row.humidity,
    humidityNotes: row.humidity_notes,
    tempMinC: row.temp_min_c,
    tempMaxC: row.temp_max_c,
    temperatureNotes: row.temperature_notes,
    soil: row.soil,
    fertilizing: row.fertilizing,
    repotting: row.repotting,
    pruning: row.pruning,
    toxicityNotes: row.toxicity_notes,
    difficulty: row.difficulty,
    commonProblems: row.common_problems,
    tips: row.tips,
    pot: row.pot,
    details: toCareDetails(row.care_details),
  };
}

function readDetails(json: string | null): CareDetailsInput {
  if (!json) return {};
  try {
    const parsed = careDetailsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function toCareDetails(json: string | null): CareDetails | null {
  if (!json) return null;
  const d = readDetails(json);
  return {
    lightGood: d.light_good ?? [],
    lightAvoid: d.light_avoid ?? [],
    wateringRule: d.watering_rule ?? null,
    wateringTips: d.watering_tips ?? [],
    thirstSigns: d.thirst_signs ?? null,
    overwateringSigns: d.overwatering_signs ?? null,
    humidityTips: d.humidity_tips ?? [],
    tempIdeal: d.temp_ideal ?? null,
    soilMix: d.soil_mix ?? [],
    fertilizerFrequency: d.fertilizer_frequency ?? null,
    fertilizerSeason: d.fertilizer_season ?? null,
    fertilizerType: d.fertilizer_type ?? null,
    repottingFrequency: d.repotting_frequency ?? null,
    repottingSeason: d.repotting_season ?? null,
    pruningTips: d.pruning_tips ?? [],
    problems: d.problems ?? [],
    keyTips: d.key_tips ?? [],
    petRisk: d.pet_risk ?? null,
  };
}

export function toDetail(db: Db, row: PlantRow, view: ViewContext): PlantDetail {
  return {
    ...toSummary(row, view),
    care: careSheet(row),
    notes: row.notes,
    createdAt: row.created_at,
    createdBy: nameOf(row.creator_name, row.creator_email),
    createdVia: row.created_via,
    lastFertilizedAt: row.last_fertilize_at,
    events: listEvents(db, row.id),
    photos: listPlantPhotos(db, row.id, row.photo),
  };
}
