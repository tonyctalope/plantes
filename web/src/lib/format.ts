import type { UserSummary } from '../../../shared/api.ts';

// Dates: the server works in the household time zone and sends calendar days
// as YYYY-MM-DD keys. Keys are formatted at noon UTC so no offset can shift
// them to the previous/next day; ISO timestamps are formatted in the
// household time zone.

const keyFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant in the given time zone. */
export function dateKey(input: string | Date, timeZone: string): string {
  let formatter = keyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    keyFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(typeof input === 'string' ? new Date(input) : input);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

/** Whole days from `fromKey` to `toKey` (positive when `toKey` is later). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((keyToDate(toKey).getTime() - keyToDate(fromKey).getTime()) / 86_400_000);
}

/** Today's key in the browser's local time zone (for date inputs). */
export function localTodayKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayShort = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** "mardi 10 novembre" */
export function formatDayLong(key: string): string {
  return dayLong.format(keyToDate(key));
}

/** "mar. 10 nov." */
export function formatDayShort(key: string): string {
  return dayShort.format(keyToDate(key));
}

/** "10 nov. 2026" */
export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(
    new Date(iso),
  );
}

/** "mar. 10 nov. à 09:12" */
export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(
    date,
  );
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
  return `${day} à ${time}`;
}

/** "aujourd'hui", "hier", "il y a 3 jours", "il y a 2 semaines"… */
export function relativeDays(iso: string, timeZone: string, today: string): string {
  const days = daysBetween(dateKey(iso, timeZone), today);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  if (days < 14) return 'il y a une semaine';
  if (days < 31) return `il y a ${Math.floor(days / 7)} semaines`;
  if (days < 61) return 'il y a un mois';
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  return "il y a plus d'un an";
}

/** Compact past date for small cards: "hier", "il y a 5 j", "il y a 3 sem.". */
export function relativeDaysShort(iso: string, timeZone: string, today: string): string {
  const days = daysBetween(dateKey(iso, timeZone), today);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 14) return `il y a ${days} j`;
  if (days < 60) return `il y a ${Math.floor(days / 7)} sem.`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  return "il y a plus d'un an";
}

/** Due date relative to today: "aujourd'hui", "demain", "dans 4 jours", "en retard de 2 jours". */
export function dueText(daysUntilDue: number): string {
  if (daysUntilDue < -1) return `en retard de ${-daysUntilDue} jours`;
  if (daysUntilDue === -1) return "en retard d'un jour";
  if (daysUntilDue === 0) return "aujourd'hui";
  if (daysUntilDue === 1) return 'demain';
  return `dans ${daysUntilDue} jours`;
}

/** Compact badge text: "Retard 2 j", "Aujourd'hui", "Demain", "Dans 4 j". */
export function dueBadge(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${-daysUntilDue} j de retard`;
  if (daysUntilDue === 0) return "Aujourd'hui";
  if (daysUntilDue === 1) return 'Demain';
  return `Dans ${daysUntilDue} j`;
}

export function everyNDays(days: number): string {
  return days === 1 ? 'tous les jours' : `tous les ${days} jours`;
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text;
}

export function displayName(user: Pick<UserSummary, 'name' | 'email'>): string {
  const name = user.name?.trim();
  if (name) return name;
  return user.email.split('@')[0] || user.email;
}

export function firstName(user: Pick<UserSummary, 'name' | 'email'>): string {
  return displayName(user).split(/\s+/)[0] ?? displayName(user);
}

export function initials(user: Pick<UserSummary, 'name' | 'email'>): string {
  const words = displayName(user)
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase('fr-FR');
}

export function temperatureRange(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')} °C`;
  if (min !== null && max !== null) return `${fmt(min).replace(' °C', '')} – ${fmt(max)}`;
  if (min !== null) return `au moins ${fmt(min)}`;
  if (max !== null) return `au plus ${fmt(max)}`;
  return null;
}
