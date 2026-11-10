// Calendar helpers. Watering is scheduled in whole days of the household's time
// zone, so dates travel as 'YYYY-MM-DD' strings and timestamps as ISO strings.

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(timeZone: string): Intl.DateTimeFormat {
  let format = dateFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormats.set(timeZone, format);
  }
  return format;
}

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormats.set(timeZone, format);
  }
  return format;
}

/** Calendar date of an instant in a time zone, as YYYY-MM-DD. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = dateFormat(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Wall-clock time of an instant in a time zone, as HH:MM (24 h). */
export function localTime(instant: Date, timeZone: string): string {
  const parts = timeFormat(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

const DAY_MS = 86_400_000;

function toUtcMidnight(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Invalid date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

/** date + n days (n may be negative). */
export function addDays(date: string, days: number): string {
  return new Date(toUtcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY_MS);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isHourMinute(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
