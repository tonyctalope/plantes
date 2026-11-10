import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse, PlantDetail, PlantsResponse } from '../shared/api.ts';
import { createPlant } from '../src/plants/store.ts';
import { createUploadLink } from '../src/plants/photos.ts';
import { browser, CHLOE, login, plantFields, sampleJpeg, setup, TONY, type TestContext } from './helpers.ts';

describe('web API', () => {
  let ctx: TestContext;
  let tony: ReturnType<typeof login>;
  let plantId: number;

  beforeEach(() => {
    ctx = setup();
    tony = login(ctx, TONY, 'Tony');
    plantId = createPlant(ctx.deps.db, plantFields(), { userId: tony.userId, via: 'Claude' });
  });
  afterEach(() => ctx.cleanup());

  const api = (route: string, init: RequestInit = {}) => ctx.app.request(`/api${route}`, init);

  it('requires a session and our own Origin for changes', async () => {
    expect((await api('/plants')).status).toBe(401);
    expect((await api('/plants', { headers: { cookie: 'plantes_session=forged' } })).status).toBe(401);
    expect((await api('/plants', { headers: { cookie: tony.cookie } })).status).toBe(200);
    const water = (headers: Record<string, string>) =>
      api(`/plants/${plantId}/care`, { method: 'POST', headers, body: JSON.stringify({ type: 'water' }) });
    expect((await water({ cookie: tony.cookie, 'content-type': 'application/json' })).status).toBe(403);
    expect(
      (await water({ cookie: tony.cookie, 'content-type': 'application/json', origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await water(browser(ctx, tony.cookie))).status).toBe(200);
  });

  it('describes the user, the household and how to connect Claude', async () => {
    login(ctx, CHLOE, 'Chloé');
    const me = (await (await api('/me', { headers: { cookie: tony.cookie } })).json()) as MeResponse;
    expect(me.user.email).toBe(TONY);
    expect(me.household.map((member) => member.email).sort()).toEqual([CHLOE, TONY]);
    expect(me.settings).toEqual({ remindersEnabled: true, reminderTime: '09:00' });
    expect(me.mcpUrl).toBe('https://plantes.test/mcp');
    expect(me.push.vapidPublicKey).toBe('BFakePublicKey');
  });

  it('logs waterings by whoever is signed in, and undoes them', async () => {
    const chloe = login(ctx, CHLOE, 'Chloé');
    const watered = (await (
      await api(`/plants/${plantId}/care`, {
        method: 'POST',
        headers: browser(ctx, chloe.cookie),
        body: JSON.stringify({ type: 'water', note: 'avec engrais' }),
      })
    ).json()) as PlantDetail;
    expect(watered.water.lastWateredBy).toBe('Chloé');
    expect(watered.water.state).toBe('ok');
    expect(watered.events[0]).toMatchObject({ type: 'water', by: 'Chloé', note: 'avec engrais', source: 'web' });
    const undone = (await (
      await api(`/plants/${plantId}/care/${watered.events[0]!.id}`, {
        method: 'DELETE',
        headers: browser(ctx, tony.cookie),
      })
    ).json()) as PlantDetail;
    expect(undone.events).toHaveLength(0);
    const future = await api(`/plants/${plantId}/care`, {
      method: 'POST',
      headers: browser(ctx, tony.cookie),
      body: JSON.stringify({ type: 'water', at: '2099-01-01T10:00:00Z' }),
    });
    expect(future.status).toBe(400);
  });

  it('waters several plants at once, snoozes, edits, archives and deletes', async () => {
    const second = createPlant(ctx.deps.db, plantFields({ nickname: 'Pothos', room: 'Cuisine' }), {
      userId: tony.userId,
      via: 'Claude',
    });
    const bulk = (await (
      await api('/plants/water', {
        method: 'POST',
        headers: browser(ctx, tony.cookie),
        body: JSON.stringify({ ids: [plantId, second] }),
      })
    ).json()) as PlantsResponse;
    expect(bulk.plants.every((plant) => plant.water.lastWateredBy === 'Tony')).toBe(true);
    expect(bulk.rooms).toEqual(['Cuisine', 'Salon']);

    const snoozed = await (
      await api(`/plants/${plantId}/snooze`, {
        method: 'POST',
        headers: browser(ctx, tony.cookie),
        body: JSON.stringify({ days: 20 }),
      })
    ).status;
    expect(snoozed).toBe(400); // max 14 days

    const patched = (await (
      await api(`/plants/${plantId}`, {
        method: 'PATCH',
        headers: browser(ctx, tony.cookie),
        body: JSON.stringify({ nickname: 'Monstera', waterIntervalRest: 15, remindersEnabled: false, notes: 'Cadeau' }),
      })
    ).json()) as PlantDetail;
    expect(patched).toMatchObject({ nickname: 'Monstera', remindersEnabled: false, notes: 'Cadeau' });
    expect(patched.care.waterIntervalRest).toBe(15);
    const sneaky = await api(`/plants/${plantId}`, {
      method: 'PATCH',
      headers: browser(ctx, tony.cookie),
      body: JSON.stringify({ toxicity_pets: 'non_toxic' }),
    });
    expect(sneaky.status).toBe(400); // care sheet fields are Claude's job

    const archived = (await (
      await api(`/plants/${second}/archive`, {
        method: 'POST',
        headers: browser(ctx, tony.cookie),
        body: JSON.stringify({ reason: 'donnée' }),
      })
    ).json()) as PlantDetail;
    expect(archived).toMatchObject({ archiveReason: 'donnée' });
    expect(
      ((await (await api('/plants', { headers: { cookie: tony.cookie } })).json()) as PlantsResponse).plants,
    ).toHaveLength(1);
    expect(
      ((await (await api('/plants?archived=1', { headers: { cookie: tony.cookie } })).json()) as PlantsResponse).plants,
    ).toHaveLength(1);
    const waterArchived = await api(`/plants/${second}/care`, {
      method: 'POST',
      headers: browser(ctx, tony.cookie),
      body: JSON.stringify({ type: 'water' }),
    });
    expect(waterArchived.status).toBe(409);

    expect((await api(`/plants/${second}`, { method: 'DELETE', headers: browser(ctx, tony.cookie) })).status).toBe(204);
    expect((await api(`/plants/${second}`, { headers: { cookie: tony.cookie } })).status).toBe(404);
  });

  it('stores photos without metadata and serves them to signed-in members only', async () => {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(await sampleJpeg())], { type: 'image/jpeg' }), 'p.jpg');
    const response = await api(`/plants/${plantId}/photo`, {
      method: 'POST',
      headers: { cookie: tony.cookie, origin: ctx.deps.config.origin },
      body: form,
    });
    expect(response.status).toBe(200);
    const plant = (await response.json()) as PlantDetail;
    const full = await ctx.app.request(plant.photo!.full, { headers: { cookie: tony.cookie } });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('image/webp');
    const image = Buffer.from(await full.arrayBuffer());
    const meta = await sharp(image).metadata();
    expect(meta.exif).toBeUndefined();
    // EXIF orientation 6 (rotate 90°) was applied: 1200×800 became portrait.
    expect([meta.width, meta.height]).toEqual([800, 1200]);
    const thumb = await sharp(
      Buffer.from(
        await (await ctx.app.request(plant.photo!.thumb, { headers: { cookie: tony.cookie } })).arrayBuffer(),
      ),
    ).metadata();
    expect([thumb.width, thumb.height]).toEqual([480, 480]);
    expect((await ctx.app.request(plant.photo!.full)).status).toBe(401);
    expect((await ctx.app.request('/photos/..%2F..%2Fplantes.db', { headers: { cookie: tony.cookie } })).status).toBe(
      404,
    );

    // Replacing the photo removes the old files.
    const again = new FormData();
    again.append('photo', new Blob([new Uint8Array(await sampleJpeg())], { type: 'image/jpeg' }), 'p.jpg');
    await api(`/plants/${plantId}/photo`, {
      method: 'POST',
      headers: { cookie: tony.cookie, origin: ctx.deps.config.origin },
      body: again,
    });
    expect(readdirSync(path.join(ctx.deps.config.dataDir, 'photos'))).toHaveLength(2);

    const notImage = new FormData();
    notImage.append('photo', new Blob(['hello'], { type: 'image/jpeg' }), 'x.jpg');
    const rejected = await api(`/plants/${plantId}/photo`, {
      method: 'POST',
      headers: { cookie: tony.cookie, origin: ctx.deps.config.origin },
      body: notImage,
    });
    expect(rejected.status).toBe(415);
  });

  it('accepts photo uploads through Claude links (form or raw body) until they expire', async () => {
    const { token } = createUploadLink(ctx.deps.db, plantId, tony.userId);
    const page = await ctx.app.request(`/p/${token}`, { headers: { accept: 'text/html' } });
    expect(page.status).toBe(200);
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await page.text()).toContain('Monstera du salon');
    const raw = await ctx.app.request(`/p/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array(await sampleJpeg()),
    });
    expect(raw.status).toBe(200);
    expect((await ctx.app.request(`/p/${'x'.repeat(43)}`)).status).toBe(404);
    const realNow = Date.now;
    Date.now = () => realNow() + 25 * 3600_000;
    try {
      expect((await ctx.app.request(`/p/${token}`)).status).toBe(404);
    } finally {
      Date.now = realNow;
    }
  });

  it('validates push subscriptions and settings', async () => {
    const subscribe = (endpoint: string) =>
      api('/push/subscriptions', {
        method: 'POST',
        headers: browser(ctx, tony.cookie),
        body: JSON.stringify({ endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }),
      });
    expect((await subscribe('https://fcm.googleapis.com/fcm/send/abc')).status).toBe(204);
    expect((await subscribe('https://169.254.169.254/latest/meta-data')).status).toBe(400);
    expect((await subscribe('http://fcm.googleapis.com/fcm/send/abc')).status).toBe(400);
    const me = (await (await api('/me', { headers: { cookie: tony.cookie } })).json()) as MeResponse;
    expect(me.push.subscriptions).toBe(1);

    const saved = await api('/settings', {
      method: 'PUT',
      headers: browser(ctx, tony.cookie),
      body: JSON.stringify({ remindersEnabled: true, reminderTime: '19:30' }),
    });
    expect(await saved.json()).toEqual({ remindersEnabled: true, reminderTime: '19:30' });
    const invalid = await api('/settings', {
      method: 'PUT',
      headers: browser(ctx, tony.cookie),
      body: JSON.stringify({ remindersEnabled: true, reminderTime: '25:00' }),
    });
    expect(invalid.status).toBe(400);
    const test = await api('/push/test', { method: 'POST', headers: browser(ctx, tony.cookie) });
    expect(await test.json()).toEqual({ sent: 1 });
    expect(ctx.push.sent[0]!.message.title).toContain('Ça marche');
  });

  it('logs out', async () => {
    const out = await ctx.app.request('/auth/logout', { method: 'POST', headers: browser(ctx, tony.cookie) });
    expect(out.status).toBe(204);
    expect((await api('/me', { headers: { cookie: tony.cookie } })).status).toBe(401);
  });

  it('sends security headers on pages', async () => {
    const page = await ctx.app.request('/');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('strict-transport-security')).toContain('max-age=');
    expect((await ctx.app.request('/healthz')).status).toBe(200);
  });
});
