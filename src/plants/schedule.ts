import type { Season, WaterState, WaterStatus } from '../../shared/api.ts';
import { addDays, daysBetween, localDate } from '../lib/time.ts';

export interface GrowingMonths {
  from: number;
  to: number;
}

export function seasonOf(date: string, months: GrowingMonths): Season {
  const month = Number(date.slice(5, 7));
  const inRange =
    months.from <= months.to ? month >= months.from && month <= months.to : month >= months.from || month <= months.to;
  return inRange ? 'growing' : 'rest';
}

export interface WaterInput {
  createdAt: string;
  lastWateredAt: string | null;
  lastWateredBy: string | null;
  intervalGrowing: number;
  intervalRest: number;
  snoozedUntil: string | null;
}

/**
 * Next watering = day of the last watering (or of the plant's arrival, so a batch
 * of new plants doesn't ring the next morning) + the interval of the current
 * season. A snooze can only push the date later; watering clears it.
 */
export function computeWaterStatus(input: WaterInput, now: Date, timeZone: string, months: GrowingMonths): WaterStatus {
  const today = localDate(now, timeZone);
  const season = seasonOf(today, months);
  const intervalDays = season === 'growing' ? input.intervalGrowing : input.intervalRest;
  const base = localDate(new Date(input.lastWateredAt ?? input.createdAt), timeZone);
  let dueDate = addDays(base, intervalDays);
  if (input.snoozedUntil && input.snoozedUntil > dueDate) dueDate = input.snoozedUntil;
  const daysUntilDue = daysBetween(today, dueDate);
  const state: WaterState =
    daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due' : daysUntilDue <= 2 ? 'soon' : 'ok';
  return {
    lastWateredAt: input.lastWateredAt,
    lastWateredBy: input.lastWateredBy,
    intervalDays,
    season,
    dueDate,
    daysUntilDue,
    state,
    snoozedUntil: input.snoozedUntil,
  };
}

export const needsWater = (status: WaterStatus): boolean => status.state === 'overdue' || status.state === 'due';
