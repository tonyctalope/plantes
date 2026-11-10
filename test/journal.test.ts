import { readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlantDetail } from '../shared/api.ts';
import { migrate } from '../src/db/database.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';
import { createPlant, getPlantRow, toDetail, updatePlant } from '../src/plants/store.ts';
import { browser, largeJpeg, login, plantFields, sampleJpeg, setup, TONY, type TestContext } from './helpers.ts';

describe('photo journal and structured care details', () => {
  let ctx: TestContext;
  let tony: ReturnType<typeof login>;
  let plantId: number;

  beforeEach(() => {
    ctx = setup();
    tony = login(ctx, TONY, 'Tony');
    plantId = createPlant(ctx.deps.db, plantFields(), { userId: tony.userId, via: 'Claude' });
  });
  afterEach(() => ctx.cleanup());

  const upload = async (route: string, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(await sampleJpeg())], { type: 'image/jpeg' }), 'p.jpg');
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const response = await ctx.app.request(`/api/plants/${plantId}${route}`, {
      method: 'POST',
      headers: { cookie: tony.cookie, origin: ctx.deps.config.origin },
      body: form,
    });
    expect(response.status).toBe(200);
    return (await response.json()) as PlantDetail;
  };
  const files = () => readdirSync(path.join(ctx.deps.config.dataDir, 'photos')).length;

  it('keeps every photo with its date and note, the first one becoming the main photo', async () => {
    const first = await upload('/photos', { note: 'Arrivée' });
    expect(first.photoCount).toBe(1);
    expect(first.photos[0]).toMatchObject({ note: 'Arrivée', isCover: true, by: 'Tony', source: 'web' });
    const second = await upload('/photos', { note: 'Nouvelle feuille' });
    expect(second.photos.map((photo) => photo.note)).toEqual(['Nouvelle feuille', 'Arrivée']);
    expect(second.photos[1]!.isCover).toBe(true); // not replaced without cover=1
    const third = await upload('/photos', { cover: '1' });
    expect(third.photos[0]!.isCover).toBe(true);
    expect(third.photoCount).toBe(3);
    expect(files()).toBe(6);
  });

  it('sets the main photo, edits notes and deletes photos with their files', async () => {
    await upload('/photos');
    const two = await upload('/photos');
    const [newest, oldest] = two.photos;
    const patch = (photoId: number, body: unknown) =>
      ctx.app.request(`/api/plants/${plantId}/photos/${photoId}`, {
        method: 'PATCH',
        headers: browser(ctx, tony.cookie),
        body: JSON.stringify(body),
      });
    const covered = (await (await patch(newest!.id, { cover: true, note: 'Plus belle' })).json()) as PlantDetail;
    expect(covered.photos[0]).toMatchObject({ isCover: true, note: 'Plus belle' });
    expect(covered.photo!.full).toBe(newest!.full);
    // Deleting the main photo promotes the newest remaining one.
    const remove = (photoId: number) =>
      ctx.app.request(`/api/plants/${plantId}/photos/${photoId}`, {
        method: 'DELETE',
        headers: browser(ctx, tony.cookie),
      });
    const after = (await (await remove(newest!.id)).json()) as PlantDetail;
    expect(after.photos).toHaveLength(1);
    expect(after.photo!.full).toBe(oldest!.full);
    expect(files()).toBe(2);
    const empty = (await (await remove(oldest!.id)).json()) as PlantDetail;
    expect(empty.photo).toBeNull();
    expect(files()).toBe(0);
    expect((await remove(oldest!.id)).status).toBe(404);
    // Photos of a deleted plant are removed too.
    await upload('/photos');
    await ctx.app.request(`/api/plants/${plantId}`, { method: 'DELETE', headers: browser(ctx, tony.cookie) });
    expect(files()).toBe(0);
  });

  it('accepts real-size phone photos and never reuses photo ids', async () => {
    const big = await largeJpeg();
    expect(big.byteLength).toBeGreaterThan(300 * 1024);
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(big)], { type: 'image/jpeg' }), 'big.jpg');
    const response = await ctx.app.request(`/api/plants/${plantId}/photos`, {
      method: 'POST',
      headers: { cookie: tony.cookie, origin: ctx.deps.config.origin },
      body: form,
    });
    expect(response.status).toBe(200);
    const withBig = (await response.json()) as PlantDetail;
    const second = await upload('/photos');
    const newestId = second.photos[0]!.id;
    await ctx.app.request(`/api/plants/${plantId}/photos/${newestId}`, {
      method: 'DELETE',
      headers: browser(ctx, tony.cookie),
    });
    const third = await upload('/photos');
    expect(third.photos[0]!.id).toBeGreaterThan(newestId);
    expect(withBig.photos).toHaveLength(1);
  });

  it('maps structured details and merges partial updates', () => {
    const view = { timezone: 'Europe/Paris', growingMonths: { from: 4, to: 9 }, now: new Date() };
    expect(toDetail(ctx.deps.db, getPlantRow(ctx.deps.db, plantId)!, view).care.details).toBeNull();
    updatePlant(ctx.deps.db, plantId, {
      details: {
        light_good: ['Fenêtre est'],
        watering_rule: 'Quand les 3 premiers cm sont secs',
        problems: [{ symptom: 'Feuilles jaunes', cause: "Excès d'eau" }],
      },
    });
    updatePlant(ctx.deps.db, plantId, {
      details: { light_avoid: ['Soleil de midi'], light_good: ['Fenêtre est ou ouest'] },
    });
    const details = toDetail(ctx.deps.db, getPlantRow(ctx.deps.db, plantId)!, view).care.details!;
    expect(details).toMatchObject({
      lightGood: ['Fenêtre est ou ouest'],
      lightAvoid: ['Soleil de midi'],
      wateringRule: 'Quand les 3 premiers cm sont secs',
      problems: [{ symptom: 'Feuilles jaunes', cause: "Excès d'eau" }],
      soilMix: [],
      petRisk: null,
    });
  });

  it('moves existing main photos into the journal when migrating', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0]!);
    db.exec('PRAGMA user_version = 1');
    db.exec(`INSERT INTO plants (nickname, common_name, scientific_name, identification_confidence, room, light,
      water_interval_growing, water_interval_rest, watering_instructions, photo, created_at, updated_at, created_via)
      VALUES ('A', 'A', 'A a', 'high', 'Salon', 'low', 7, 10, 'x', 'AAAAAAAAAAAAAAAAAAAAAA', '2026-01-01', '2026-01-02', 'test')`);
    migrate(db);
    expect(db.prepare('SELECT plant_id, stem, source FROM plant_photos').all()).toEqual([
      { plant_id: 1, stem: 'AAAAAAAAAAAAAAAAAAAAAA', source: 'link' },
    ]);
    db.close();
  });
});
