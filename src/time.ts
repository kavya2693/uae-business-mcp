// Calendar and clock helpers that always work in the business's own time zone
// (Asia/Dubai), whatever time zone the server process runs in (Vercel runs in UTC).

import { WEEKDAYS, type Weekday } from './config.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function isValidTime(time: string): boolean {
  return TIME_RE.test(time);
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function partsIn(timeZone: string, instant: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    second: Number(p.second),
  };
}

/** Wall-clock date and time in `timeZone` at `instant`. */
export function localNow(timeZone: string, instant: Date = new Date()) {
  const { date, time } = partsIn(timeZone, instant);
  return { date, time, minutes: toMinutes(time), weekday: weekdayOf(date) };
}

function offsetMinutes(timeZone: string, instant: Date): number {
  const { date, time, second } = partsIn(timeZone, instant);
  const asUtc = Date.parse(`${date}T${time}:${String(second).padStart(2, '0')}Z`);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The absolute instant of a wall-clock `date` + `time` in `timeZone`. */
export function toInstant(timeZone: string, date: string, time: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`);
  let guess = naive - offsetMinutes(timeZone, new Date(naive)) * 60000;
  // Second pass corrects the guess when the offset differs across a DST change.
  guess = naive - offsetMinutes(timeZone, new Date(guess)) * 60000;
  return new Date(guess);
}
