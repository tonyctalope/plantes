import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isHourMinute, isIsoDate, localDate, localTime } from '../src/lib/time.ts';
import { computeWaterStatus, seasonOf } from '../src/plants/schedule.ts';

const months = { from: 4, to: 9 };
const TZ = 'Europe/Paris';

describe('time helpers', () => {
  it('formats local dates and times in the household time zone', () => {
    // 23:30 UTC on Nov 9 is already Nov 10 in Paris (UTC+1).
    const instant = new Date('2026-11-09T23:30:00Z');
    expect(localDate(instant, TZ)).toBe('2026-11-10');
    expect(localTime(instant, TZ)).toBe('00:30');
    expect(localDate(instant, 'America/New_York')).toBe('2026-11-09');
  });

  it('does calendar arithmetic across month, year and DST boundaries', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-11-10', '2026-11-08')).toBe(-2);
  });

  it('validates dates and times', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isHourMinute('09:00')).toBe(true);
    expect(isHourMinute('24:00')).toBe(false);
    expect(isHourMinute('9:00')).toBe(false);
  });
});

describe('watering schedule', () => {
  const base = {
    createdAt: '2026-11-01T10:00:00.000Z',
    lastWateredAt: null,
    lastWateredBy: null,
    intervalGrowing: 7,
    intervalRest: 12,
    snoozedUntil: null,
  };

  it('uses the growing-season interval from April to September', () => {
    expect(seasonOf('2026-04-01', months)).toBe('growing');
    expect(seasonOf('2026-09-30', months)).toBe('growing');
    expect(seasonOf('2026-10-01', months)).toBe('rest');
    expect(seasonOf('2026-03-31', months)).toBe('rest');
    // Southern-hemisphere style wrap-around range.
    expect(seasonOf('2026-01-15', { from: 10, to: 3 })).toBe('growing');
    expect(seasonOf('2026-06-15', { from: 10, to: 3 })).toBe('rest');
  });

  it('starts from the arrival date when no watering was logged', () => {
    const status = computeWaterStatus(base, new Date('2026-11-05T09:00:00Z'), TZ, months);
    expect(status).toMatchObject({
      season: 'rest',
      intervalDays: 12,
      dueDate: '2026-11-13',
      daysUntilDue: 8,
      state: 'ok',
    });
  });

  it('counts from the last watering and flags due / soon / overdue', () => {
    const watered = { ...base, lastWateredAt: '2026-11-01T18:00:00.000Z' };
    expect(computeWaterStatus(watered, new Date('2026-11-11T08:00:00Z'), TZ, months).state).toBe('soon');
    expect(computeWaterStatus(watered, new Date('2026-11-13T08:00:00Z'), TZ, months)).toMatchObject({
      state: 'due',
      daysUntilDue: 0,
    });
    expect(computeWaterStatus(watered, new Date('2026-11-15T08:00:00Z'), TZ, months)).toMatchObject({
      state: 'overdue',
      daysUntilDue: -2,
    });
  });

  it('uses the local calendar day of the watering, not UTC', () => {
    // Watered at 00:30 Paris time on Nov 2 (23:30 UTC on Nov 1).
    const watered = { ...base, lastWateredAt: '2026-11-01T23:30:00.000Z' };
    expect(computeWaterStatus(watered, new Date('2026-11-05T09:00:00Z'), TZ, months).dueDate).toBe('2026-11-14');
  });

  it('lets a snooze push the due date later, never earlier', () => {
    const watered = { ...base, lastWateredAt: '2026-11-01T10:00:00.000Z' };
    const now = new Date('2026-11-13T08:00:00Z');
    expect(computeWaterStatus({ ...watered, snoozedUntil: '2026-11-15' }, now, TZ, months)).toMatchObject({
      dueDate: '2026-11-15',
      state: 'soon',
    });
    expect(computeWaterStatus({ ...watered, snoozedUntil: '2026-11-10' }, now, TZ, months).dueDate).toBe('2026-11-13');
  });
});
