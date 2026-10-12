// Pure availability logic: opening hours, bookable slots and capacity.
// Nothing here touches storage; callers pass in a function that counts existing bookings.

import type { Business } from './config.js';
import { addDays, fromMinutes, isValidDate, isValidTime, localNow, toInstant, toMinutes, weekdayOf } from './time.js';

export interface Slot {
  /** Calendar date the guest arrives (YYYY-MM-DD, local time). */
  date: string;
  /** Arrival time (HH:MM, local time). */
  time: string;
}

/** Opening intervals for a service day, in minutes from that day's midnight. close may exceed 1440 (past midnight). */
export function serviceIntervals(business: Business, serviceDate: string): { open: number; close: number }[] {
  if (business.closures.some((c) => c.date === serviceDate)) return [];
  return (business.openingHours[weekdayOf(serviceDate)] ?? []).map(({ open, close }) => {
    const o = toMinutes(open);
    let c = toMinutes(close);
    if (c <= o) c += 1440;
    return { open: o, close: c };
  });
}

/** Every arrival slot that falls on calendar `date`, including the after-midnight tail of the previous day's service. */
export function slotsOnDate(business: Business, date: string): Slot[] {
  const { slotLengthMinutes, lastSeatingBeforeCloseMinutes } = business.bookingRules;
  const times = new Set<number>();
  for (const [serviceDate, shift] of [
    [addDays(date, -1), -1440],
    [date, 0],
  ] as const) {
    for (const { open, close } of serviceIntervals(business, serviceDate)) {
      const lastSeating = close - lastSeatingBeforeCloseMinutes;
      for (let t = open; t <= lastSeating; t += slotLengthMinutes) {
        const onDate = t + shift;
        if (onDate >= 0 && onDate < 1440) times.add(onDate);
      }
    }
  }
  return [...times].sort((a, b) => a - b).map((m) => ({ date, time: fromMinutes(m) }));
}

export interface OpenStatus {
  isOpenNow: boolean;
  localDate: string;
  localTime: string;
  weekday: string;
  /** When the current opening interval ends (if open) — local date and time. */
  closesAt?: Slot;
  /** Next time the place opens (if closed now) — local date and time. */
  nextOpensAt?: Slot;
}

export function openStatus(business: Business, now: Date = new Date()): OpenStatus {
  const local = localNow(business.timezone, now);
  const base = { localDate: local.date, localTime: local.time, weekday: local.weekday };

  for (const [serviceDate, shift] of [
    [addDays(local.date, -1), 1440],
    [local.date, 0],
  ] as const) {
    for (const { open, close } of serviceIntervals(business, serviceDate)) {
      const m = local.minutes + shift;
      if (m >= open && m < close) {
        return {
          ...base,
          isOpenNow: true,
          closesAt: { date: addDays(serviceDate, Math.floor(close / 1440)), time: fromMinutes(close) },
        };
      }
    }
  }

  for (let i = 0; i <= 14; i++) {
    const serviceDate = addDays(local.date, i);
    const next = serviceIntervals(business, serviceDate)
      .map((x) => x.open)
      .filter((o) => i > 0 || o > local.minutes)
      .sort((a, b) => a - b)[0];
    if (next !== undefined) {
      return { ...base, isOpenNow: false, nextOpensAt: { date: serviceDate, time: fromMinutes(next) } };
    }
  }
  return { ...base, isOpenNow: false };
}

export type RequestProblem =
  | 'INVALID_DATE'
  | 'INVALID_TIME'
  | 'INVALID_PARTY_SIZE'
  | 'PARTY_TOO_LARGE'
  | 'DATE_IN_PAST'
  | 'TOO_SOON'
  | 'TOO_FAR_AHEAD'
  | 'CLOSED_ON_DATE'
  | 'OUTSIDE_BOOKING_HOURS'
  | 'SLOT_FULL';

export interface ProblemDetail {
  code: RequestProblem;
  message: string;
}

/** Checks a date/time/party request against the rules (not capacity). Returns the first problem, or null. */
export function checkRequestRules(
  business: Business,
  req: { date: string; time: string; partySize: number },
  now: Date = new Date(),
): ProblemDetail | null {
  const rules = business.bookingRules;
  if (!isValidDate(req.date)) return { code: 'INVALID_DATE', message: 'Date must be a real calendar date in YYYY-MM-DD format.' };
  if (!isValidTime(req.time)) return { code: 'INVALID_TIME', message: 'Time must be HH:MM in 24-hour format, e.g. 19:30.' };
  if (!Number.isInteger(req.partySize) || req.partySize < 1) {
    return { code: 'INVALID_PARTY_SIZE', message: 'Party size must be a whole number of at least 1.' };
  }
  if (req.partySize > rules.maxPartySize) {
    return {
      code: 'PARTY_TOO_LARGE',
      message: `Online requests are limited to ${rules.maxPartySize} guests. ${rules.largeGroupNote} Phone: ${business.phone}.`.trim(),
    };
  }

  const tz = business.timezone;
  const today = localNow(tz, now).date;
  if (req.date < today) return { code: 'DATE_IN_PAST', message: `That date is in the past. Today in ${tz} is ${today}.` };
  if (req.date > addDays(today, rules.maxDaysAhead)) {
    return { code: 'TOO_FAR_AHEAD', message: `Bookings open at most ${rules.maxDaysAhead} days ahead (until ${addDays(today, rules.maxDaysAhead)}).` };
  }

  const slots = slotsOnDate(business, req.date);
  if (slots.length === 0) return { code: 'CLOSED_ON_DATE', message: `${business.name} takes no bookings on ${req.date} (${weekdayOf(req.date)}).` };
  if (!slots.some((s) => s.time === req.time)) {
    return {
      code: 'OUTSIDE_BOOKING_HOURS',
      message: `${req.time} is not a bookable arrival time on ${req.date}. Arrival times run every ${rules.slotLengthMinutes} minutes from ${slots[0].time} to ${slots[slots.length - 1].time}.`,
    };
  }

  const earliest = now.getTime() + rules.minimumNoticeMinutes * 60000;
  const instant = toInstant(tz, req.date, req.time).getTime();
  if (instant < now.getTime()) return { code: 'DATE_IN_PAST', message: `${req.date} ${req.time} has already passed in ${tz}.` };
  if (instant < earliest) {
    return { code: 'TOO_SOON', message: `Requests need at least ${rules.minimumNoticeMinutes} minutes' notice. For sooner tables, call ${business.phone}.` };
  }
  return null;
}

export type CountBooked = (date: string, time: string) => Promise<number>;

export interface AvailableSlot extends Slot {
  tablesLeft: number;
}

export interface AvailabilityResult {
  requested: { date: string; time: string; partySize: number };
  requestedSlotAvailable: boolean;
  problem: ProblemDetail | null;
  /** Bookable slots nearest the requested time, in time order. */
  slots: AvailableSlot[];
}

/** Open slots near the requested time on the requested date. */
export async function checkAvailability(
  business: Business,
  req: { date: string; time: string; partySize: number },
  countBooked: CountBooked,
  now: Date = new Date(),
  maxResults = 6,
): Promise<AvailabilityResult> {
  const problem = checkRequestRules(business, req, now);
  const result: AvailabilityResult = { requested: req, requestedSlotAvailable: false, problem, slots: [] };
  if (problem && !['OUTSIDE_BOOKING_HOURS', 'TOO_SOON', 'DATE_IN_PAST'].includes(problem.code)) return result;
  if (problem?.code === 'DATE_IN_PAST' && req.date < localNow(business.timezone, now).date) return result;

  const { tablesPerSlot, minimumNoticeMinutes } = business.bookingRules;
  const earliest = now.getTime() + minimumNoticeMinutes * 60000;
  const target = isValidTime(req.time) ? toMinutes(req.time) : 19 * 60;

  const candidates = slotsOnDate(business, req.date).filter(
    (s) => toInstant(business.timezone, s.date, s.time).getTime() >= earliest,
  );
  const withCapacity: AvailableSlot[] = [];
  for (const s of candidates) {
    const tablesLeft = tablesPerSlot - (await countBooked(s.date, s.time));
    if (tablesLeft > 0) withCapacity.push({ ...s, tablesLeft });
  }

  result.requestedSlotAvailable = !problem && withCapacity.some((s) => s.time === req.time);
  if (!problem && !result.requestedSlotAvailable) {
    result.problem = { code: 'SLOT_FULL', message: `No tables are left at ${req.time} on ${req.date}.` };
  }
  result.slots = withCapacity
    .sort((a, b) => Math.abs(toMinutes(a.time) - target) - Math.abs(toMinutes(b.time) - target))
    .slice(0, maxResults)
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  return result;
}
