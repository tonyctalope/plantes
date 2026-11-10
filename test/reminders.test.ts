import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/db/database.ts';
import { addCareEvent, createPlant, updatePlant } from '../src/plants/store.ts';
import { saveSubscription } from '../src/push/push.ts';
import { reminderMessage, runReminders, saveSettings } from '../src/push/reminders.ts';
import { CHLOE, login, plantFields, setup, TONY, type TestContext } from './helpers.ts';

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
};

describe('daily watering reminders', () => {
  let ctx: TestContext;
  let tonyId: number;

  beforeEach(() => {
    // Plants arrive on Nov 1 (rest period: 12-day interval → due Nov 13).
    ctx = setup({ now: new Date('2026-11-01T09:00:00Z') });
    tonyId = login(ctx, TONY, 'Tony').userId;
    run(ctx.deps.db, "UPDATE users SET created_at = '2026-11-01T09:00:00.000Z'");
    createPlant(ctx.deps.db, plantFields(), { userId: tonyId, via: 'Claude' });
    createPlant(ctx.deps.db, plantFields({ nickname: 'Pothos', water_interval_rest: 20 }), {
      userId: tonyId,
      via: 'Claude',
    });
    run(ctx.deps.db, "UPDATE plants SET created_at = '2026-11-01T09:00:00.000Z'");
    saveSubscription(ctx.deps.db, tonyId, SUBSCRIPTION, 'test');
    saveSettings(ctx.deps.db, tonyId, { remindersEnabled: true, reminderTime: '09:00' });
  });
  afterEach(() => ctx.cleanup());

  const at = (iso: string) => runReminders(ctx.deps, new Date(iso));

  it('rings once, at or after the chosen time, only when something is due', async () => {
    expect(await at('2026-11-12T08:30:00Z')).toBe(0); // 09:30 Paris but nothing due yet
    expect(await at('2026-11-13T07:59:00Z')).toBe(0); // 08:59 Paris: too early
    expect(await at('2026-11-13T08:00:00Z')).toBe(1); // 09:00 Paris
    expect(ctx.push.sent[0]!.message).toMatchObject({
      title: '💧 Monstera du salon a soif',
      plantIds: [1],
      url: '/plante/1',
    });
    expect(await at('2026-11-13T15:00:00Z')).toBe(0); // already reminded today
    expect(await at('2026-11-14T08:05:00Z')).toBe(1); // still not watered: reminded again
    expect(ctx.push.sent[1]!.message.body).toContain('En retard de 1 jour');
  });

  it('stops once someone waters, and skips late evenings', async () => {
    addCareEvent(ctx.deps.db, 1, { type: 'water', at: '2026-11-13T07:00:00.000Z', userId: tonyId, source: 'web' });
    expect(await at('2026-11-13T08:00:00Z')).toBe(0);
    expect(await at('2026-11-25T21:00:00Z')).toBe(0); // 22:00 Paris: too late, tomorrow instead
    expect(await at('2026-11-26T08:00:00Z')).toBe(1);
  });

  it('groups several plants and respects per-plant and per-person switches', async () => {
    const chloeId = login(ctx, CHLOE, 'Chloé').userId;
    saveSubscription(
      ctx.deps.db,
      chloeId,
      { ...SUBSCRIPTION, endpoint: 'https://fcm.googleapis.com/fcm/send/y' },
      'test',
    );
    saveSettings(ctx.deps.db, chloeId, { remindersEnabled: true, reminderTime: '18:00' });
    expect(await at('2026-11-21T08:00:00Z')).toBe(1); // Tony at 09:00, both plants due
    expect(ctx.push.sent[0]!.message).toMatchObject({ title: '💧 2 plantes à arroser', url: '/' });
    expect(ctx.push.sent[0]!.message.body).toBe('Monstera du salon, Pothos (dont 1 en retard)');
    expect(await at('2026-11-21T17:00:00Z')).toBe(1); // Chloé at 18:00
    expect(ctx.push.sent[1]!.userId).toBe(chloeId);

    updatePlant(ctx.deps.db, 1, { reminders_enabled: false });
    saveSettings(ctx.deps.db, chloeId, { remindersEnabled: false, reminderTime: '18:00' });
    expect(await at('2026-11-22T17:30:00Z')).toBe(1);
    expect(ctx.push.sent.at(-1)).toMatchObject({ userId: tonyId, message: { plantIds: [2] } });
  });

  it('writes French messages', () => {
    expect(reminderMessage([{ id: 3, nickname: 'Ficus', room: 'Bureau', daysUntilDue: -3 }]).body).toBe(
      'En retard de 3 jours · Bureau',
    );
    const many = reminderMessage(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((nickname, index) => ({ id: index, nickname, room: 'X', daysUntilDue: 0 })),
    );
    expect(many.body).toBe('A, B, C, D et 2 autres');
  });
});
