import type { UserSettings } from '../../shared/api.ts';
import { all, get, run, type Db } from '../db/database.ts';
import { isHourMinute, localDate, localTime } from '../lib/time.ts';
import { needsWater } from '../plants/schedule.ts';
import { listPlantRows, toSummary } from '../plants/store.ts';
import { allowlist, type Deps } from '../types.ts';
import type { PushMessage } from './push.ts';

/** No reminder starts after this local time; a missed day is simply folded into the next one. */
const LATEST_REMINDER = '21:30';

export function getSettings(db: Db, userId: number): UserSettings {
  run(db, 'INSERT OR IGNORE INTO user_settings (user_id) VALUES (:user)', { user: userId });
  const row = get<{ reminders_enabled: number; reminder_time: string }>(
    db,
    'SELECT reminders_enabled, reminder_time FROM user_settings WHERE user_id = :user',
    { user: userId },
  )!;
  return { remindersEnabled: row.reminders_enabled === 1, reminderTime: row.reminder_time };
}

export function saveSettings(db: Db, userId: number, settings: UserSettings): UserSettings {
  if (!isHourMinute(settings.reminderTime)) throw new RangeError('reminderTime must be HH:MM');
  getSettings(db, userId);
  run(db, 'UPDATE user_settings SET reminders_enabled = :enabled, reminder_time = :time WHERE user_id = :user', {
    enabled: settings.remindersEnabled ? 1 : 0,
    time: settings.reminderTime,
    user: userId,
  });
  return getSettings(db, userId);
}

export function reminderMessage(
  plants: { id: number; nickname: string; room: string; daysUntilDue: number }[],
): PushMessage {
  const overdue = plants.filter((plant) => plant.daysUntilDue < 0).length;
  if (plants.length === 1) {
    const plant = plants[0]!;
    const late = -plant.daysUntilDue;
    return {
      title: `💧 ${plant.nickname} a soif`,
      body: `${late > 0 ? `En retard de ${late} jour${late > 1 ? 's' : ''}` : 'À arroser aujourd’hui'} · ${plant.room}`,
      url: `/plante/${plant.id}`,
      tag: 'plantes-reminder',
      plantIds: [plant.id],
    };
  }
  const names = plants.slice(0, 4).map((plant) => plant.nickname);
  const more = plants.length - names.length;
  return {
    title: `💧 ${plants.length} plantes à arroser`,
    body: `${names.join(', ')}${more > 0 ? ` et ${more} autre${more > 1 ? 's' : ''}` : ''}${overdue ? ` (dont ${overdue} en retard)` : ''}`,
    url: '/',
    tag: 'plantes-reminder',
    plantIds: plants.map((plant) => plant.id),
  };
}

/** Plants whose reminder should ring today (overdue or due, reminders on, not archived). */
export function duePlants(deps: Deps, now: Date) {
  const view = { timezone: deps.config.timezone, growingMonths: deps.config.growingMonths, now };
  return listPlantRows(deps.db)
    .filter((row) => row.reminders_enabled === 1)
    .map((row) => toSummary(row, view))
    .filter((plant) => needsWater(plant.water))
    .sort((a, b) => a.water.daysUntilDue - b.water.daysUntilDue || a.nickname.localeCompare(b.nickname, 'fr'));
}

/**
 * Called every minute: at or after each member's reminder time (once per day),
 * sends the list of thirsty plants to all their devices.
 */
export async function runReminders(deps: Deps, now = deps.now()): Promise<number> {
  const { db, config } = deps;
  const isAllowed = allowlist(config);
  const today = localDate(now, config.timezone);
  const time = localTime(now, config.timezone);
  if (time > LATEST_REMINDER) return 0;
  const members = all<{ user_id: number; email: string; reminder_time: string; last_reminder_date: string | null }>(
    db,
    `SELECT s.user_id, u.email, s.reminder_time, s.last_reminder_date
       FROM user_settings s JOIN users u ON u.id = s.user_id
      WHERE s.reminders_enabled = 1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)`,
  ).filter((member) => isAllowed(member.email) && member.last_reminder_date !== today && time >= member.reminder_time);
  if (members.length === 0) return 0;
  const plants = duePlants(deps, now);
  let sent = 0;
  for (const member of members) {
    // Mark first: a crash or a slow push service must never mean a second reminder.
    run(db, 'UPDATE user_settings SET last_reminder_date = :today WHERE user_id = :user', {
      today,
      user: member.user_id,
    });
    if (plants.length === 0) continue;
    const message = reminderMessage(
      plants.map((plant) => ({
        id: plant.id,
        nickname: plant.nickname,
        room: plant.room,
        daysUntilDue: plant.water.daysUntilDue,
      })),
    );
    sent += await deps.push.sendToUser(member.user_id, message);
  }
  if (sent) console.info(`reminders: ${plants.length} plant(s) due, ${sent} notification(s) delivered`);
  return sent;
}
