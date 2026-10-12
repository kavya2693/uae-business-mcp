import { describe, expect, it } from 'vitest';
import { loadBusiness } from '../src/config.js';
import { checkAvailability, checkRequestRules, openStatus, slotsOnDate } from '../src/availability.js';
import { localNow, toInstant } from '../src/time.js';

const business = loadBusiness();
// Monday 2026-10-12, 10:00 in Dubai (UTC+4).
const MON_10AM = new Date('2026-10-12T06:00:00Z');
const none = async () => 0;

describe('time helpers', () => {
  it('reads Dubai wall-clock time from a UTC instant', () => {
    expect(localNow('Asia/Dubai', MON_10AM)).toMatchObject({ date: '2026-10-12', time: '10:00', weekday: 'monday' });
  });

  it('converts Dubai wall-clock time back to the right instant', () => {
    expect(toInstant('Asia/Dubai', '2026-10-12', '19:30').toISOString()).toBe('2026-10-12T15:30:00.000Z');
  });

  it('rolls the date over at Dubai midnight, not UTC midnight', () => {
    expect(localNow('Asia/Dubai', new Date('2026-10-12T21:30:00Z')).date).toBe('2026-10-13');
  });
});

describe('slotsOnDate', () => {
  it('runs every 30 minutes from opening to last seating on a weekday', () => {
    const slots = slotsOnDate(business, '2026-10-12'); // Monday 12:00-23:00, last seating 22:00
    expect(slots[0].time).toBe('12:00');
    expect(slots.at(-1)!.time).toBe('22:00');
    expect(slots).toHaveLength(21);
  });

  it("includes the after-midnight tail of Friday's service on Saturday", () => {
    // Friday 13:00-01:00 → last seating 00:00 on Saturday's calendar date.
    const sat = slotsOnDate(business, '2026-10-17').map((s) => s.time);
    expect(sat[0]).toBe('00:00');
    expect(sat).toContain('10:00');
  });

  it('returns nothing on a closure date', () => {
    const closed = { ...business, closures: [{ date: '2026-10-14' }] };
    expect(slotsOnDate(closed, '2026-10-14')).toEqual([]);
  });
});

describe('openStatus', () => {
  it('is closed at 10:00 on Monday and opens at 12:00', () => {
    const s = openStatus(business, MON_10AM);
    expect(s.isOpenNow).toBe(false);
    expect(s.nextOpensAt).toEqual({ date: '2026-10-12', time: '12:00' });
  });

  it('is open at 19:00 on Monday and closes at 23:00', () => {
    const s = openStatus(business, new Date('2026-10-12T15:00:00Z'));
    expect(s.isOpenNow).toBe(true);
    expect(s.closesAt).toEqual({ date: '2026-10-12', time: '23:00' });
  });

  it("is still open at 00:30 on Saturday from Friday's late service", () => {
    const s = openStatus(business, new Date('2026-10-16T20:30:00Z')); // Sat 00:30 Dubai
    expect(s.isOpenNow).toBe(true);
    expect(s.closesAt).toEqual({ date: '2026-10-17', time: '01:00' });
  });

  it('is closed at 02:00 on Saturday and reopens at 10:00', () => {
    const s = openStatus(business, new Date('2026-10-16T22:00:00Z'));
    expect(s.isOpenNow).toBe(false);
    expect(s.nextOpensAt).toEqual({ date: '2026-10-17', time: '10:00' });
  });
});

describe('checkRequestRules', () => {
  const ok = { date: '2026-10-13', time: '19:30', partySize: 4 };

  it('accepts a valid request', () => {
    expect(checkRequestRules(business, ok, MON_10AM)).toBeNull();
  });

  it.each([
    [{ ...ok, date: '2026-02-30' }, 'INVALID_DATE'],
    [{ ...ok, date: '13/10/2026' }, 'INVALID_DATE'],
    [{ ...ok, time: '7pm' }, 'INVALID_TIME'],
    [{ ...ok, partySize: 0 }, 'INVALID_PARTY_SIZE'],
    [{ ...ok, partySize: 2.5 }, 'INVALID_PARTY_SIZE'],
    [{ ...ok, partySize: 9 }, 'PARTY_TOO_LARGE'],
    [{ ...ok, date: '2026-10-11' }, 'DATE_IN_PAST'],
    [{ ...ok, date: '2026-12-31' }, 'TOO_FAR_AHEAD'],
    [{ ...ok, time: '23:30' }, 'OUTSIDE_BOOKING_HOURS'],
    [{ ...ok, time: '11:00' }, 'OUTSIDE_BOOKING_HOURS'],
    [{ ...ok, time: '19:45' }, 'OUTSIDE_BOOKING_HOURS'],
    [{ ...ok, date: '2026-10-12', time: '11:30' }, 'OUTSIDE_BOOKING_HOURS'],
  ] as const)('%o → %s', (req, code) => {
    expect(checkRequestRules(business, req, MON_10AM)?.code).toBe(code);
  });

  it('mentions the phone number for large groups', () => {
    expect(checkRequestRules(business, { ...ok, partySize: 12 }, MON_10AM)?.message).toContain(business.phone);
  });

  it('accepts the last seating exactly', () => {
    expect(checkRequestRules(business, { ...ok, time: '22:00' }, MON_10AM)).toBeNull();
  });

  it('accepts a slot exactly at the minimum notice and rejects one minute less', () => {
    const noon = { date: '2026-10-12', time: '12:00', partySize: 2 };
    expect(checkRequestRules(business, noon, new Date('2026-10-12T06:00:00Z'))).toBeNull();
    expect(checkRequestRules(business, noon, new Date('2026-10-12T06:01:00Z'))?.code).toBe('TOO_SOON');
  });

  it('rejects a slot earlier today that has already passed', () => {
    const at15 = new Date('2026-10-12T11:00:00Z'); // 15:00 Dubai
    expect(checkRequestRules(business, { date: '2026-10-12', time: '13:00', partySize: 2 }, at15)?.code).toBe('DATE_IN_PAST');
  });
});

describe('checkAvailability', () => {
  it('reports the requested slot as available when empty', async () => {
    const r = await checkAvailability(business, { date: '2026-10-13', time: '19:30', partySize: 2 }, none, MON_10AM);
    expect(r.requestedSlotAvailable).toBe(true);
    expect(r.problem).toBeNull();
    expect(r.slots.map((s) => s.time)).toContain('19:30');
    expect(r.slots.every((s) => s.tablesLeft === business.bookingRules.tablesPerSlot)).toBe(true);
  });

  it('offers nearby slots when the requested one is full', async () => {
    const full = async (_d: string, t: string) => (t === '19:30' ? business.bookingRules.tablesPerSlot : 0);
    const r = await checkAvailability(business, { date: '2026-10-13', time: '19:30', partySize: 2 }, full, MON_10AM);
    expect(r.requestedSlotAvailable).toBe(false);
    expect(r.problem?.code).toBe('SLOT_FULL');
    expect(r.slots.map((s) => s.time)).toEqual(['18:30', '19:00', '20:00', '20:30', '21:00', '18:00'].sort());
  });

  it('subtracts existing bookings from tablesLeft', async () => {
    const some = async () => 3;
    const r = await checkAvailability(business, { date: '2026-10-13', time: '19:30', partySize: 2 }, some, MON_10AM);
    expect(r.slots.every((s) => s.tablesLeft === 1)).toBe(true);
  });

  it('suggests real slots for an off-grid time', async () => {
    const r = await checkAvailability(business, { date: '2026-10-13', time: '19:45', partySize: 2 }, none, MON_10AM);
    expect(r.problem?.code).toBe('OUTSIDE_BOOKING_HOURS');
    expect(r.slots.map((s) => s.time)).toContain('19:30');
    expect(r.slots.map((s) => s.time)).toContain('20:00');
  });

  it('only offers later slots today when the requested one is too soon', async () => {
    const at1030 = new Date('2026-10-12T06:30:00Z'); // earliest bookable = 12:30
    const r = await checkAvailability(business, { date: '2026-10-12', time: '12:00', partySize: 2 }, none, at1030);
    expect(r.problem?.code).toBe('TOO_SOON');
    expect(r.slots[0].time).toBe('12:30');
    expect(r.slots.every((s) => s.time >= '12:30')).toBe(true);
  });

  it('returns no slots for a party that is too large', async () => {
    const r = await checkAvailability(business, { date: '2026-10-13', time: '19:30', partySize: 20 }, none, MON_10AM);
    expect(r.problem?.code).toBe('PARTY_TOO_LARGE');
    expect(r.slots).toEqual([]);
  });

  it('returns no slots for a past date', async () => {
    const r = await checkAvailability(business, { date: '2026-10-01', time: '19:30', partySize: 2 }, none, MON_10AM);
    expect(r.problem?.code).toBe('DATE_IN_PAST');
    expect(r.slots).toEqual([]);
  });
});
