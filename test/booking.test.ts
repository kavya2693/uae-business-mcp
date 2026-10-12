import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBusiness } from '../src/config.js';
import { generateReference, getBookingStatus, normalizeUaePhone, requestBooking, type BookingInput } from '../src/booking.js';
import { FileBookingStore } from '../src/storage/file.js';
import { MemoryBookingStore } from '../src/storage/memory.js';

const business = loadBusiness();
const MON_10AM = new Date('2026-10-12T06:00:00Z');
const input: BookingInput = { name: 'Aisha Test', phone: '050 123 4567', date: '2026-10-13', time: '19:30', partySize: 4, notes: 'Terrace please' };

describe('normalizeUaePhone', () => {
  it.each([
    ['+971 50 123 4567', '+971501234567', 'mobile'],
    ['00971501234567', '+971501234567', 'mobile'],
    ['971501234567', '+971501234567', 'mobile'],
    ['050-123-4567', '+971501234567', 'mobile'],
    ['(055) 765 4321', '+971557654321', 'mobile'],
    ['+971 (0)58 111 2222', '+971581112222', 'mobile'],
    ['04 123 4567', '+97141234567', 'landline'],
    ['+971 2 123 4567', '+97121234567', 'landline'],
  ])('%s → %s', (raw, e164, kind) => {
    expect(normalizeUaePhone(raw)).toEqual({ ok: true, e164, kind });
  });

  it.each(['', '12345', '+44 20 7946 0000', '+971 51 123 4567', '+971 50 123 456', '+971 50 123 45678', '050 123 4567 ext 2', 'call me'])(
    'rejects %s',
    (raw) => {
      expect(normalizeUaePhone(raw).ok).toBe(false);
    },
  );
});

describe('generateReference', () => {
  it('uses the business prefix and an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) expect(generateReference('DK')).toMatch(/^DK-[A-HJKMNP-Z2-9]{6}$/);
  });
});

describe('requestBooking', () => {
  it('creates a PENDING booking with a normalised phone', async () => {
    const store = new MemoryBookingStore();
    const r = await requestBooking(business, store, input, MON_10AM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking).toMatchObject({ status: 'PENDING', phone: '+971501234567', partySize: 4, businessId: business.id });
    expect(await store.get(r.booking.reference)).toEqual(r.booking);
  });

  it.each([
    [{ name: 'A' }, 'INVALID_NAME'],
    [{ phone: '+44 20 7946 0000' }, 'INVALID_PHONE'],
    [{ notes: 'x'.repeat(501) }, 'NOTES_TOO_LONG'],
    [{ date: '2026-10-11' }, 'DATE_IN_PAST'],
    [{ date: '2026-10-12', time: '12:00' }, 'TOO_SOON'],
    [{ time: '23:30' }, 'OUTSIDE_BOOKING_HOURS'],
    [{ partySize: 9 }, 'PARTY_TOO_LARGE'],
    [{ partySize: 0 }, 'INVALID_PARTY_SIZE'],
  ] as const)('rejects %o with %s and stores nothing', async (patch, code) => {
    const store = new MemoryBookingStore();
    const at = 'time' in patch && patch.time === '12:00' ? new Date('2026-10-12T06:30:00Z') : MON_10AM;
    const r = await requestBooking(business, store, { ...input, ...patch }, at);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(code);
    expect(await store.list()).toEqual([]);
  });

  it('fills a slot to capacity, then refuses and offers alternatives', async () => {
    const store = new MemoryBookingStore();
    for (let i = 0; i < business.bookingRules.tablesPerSlot; i++) {
      expect((await requestBooking(business, store, input, MON_10AM)).ok).toBe(true);
    }
    const r = await requestBooking(business, store, input, MON_10AM);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SLOT_FULL');
    expect(r.alternativeSlots.length).toBeGreaterThan(0);
    expect(r.alternativeSlots.map((s) => s.time)).not.toContain('19:30');
  });

  it('frees the table when a booking is declined', async () => {
    const store = new MemoryBookingStore();
    const refs: string[] = [];
    for (let i = 0; i < business.bookingRules.tablesPerSlot; i++) {
      const r = await requestBooking(business, store, input, MON_10AM);
      if (r.ok) refs.push(r.booking.reference);
    }
    await store.setStatus(refs[0], 'DECLINED');
    expect((await requestBooking(business, store, input, MON_10AM)).ok).toBe(true);
  });

  it('never double-books past capacity under concurrent requests', async () => {
    const store = new MemoryBookingStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => requestBooking(business, store, input, MON_10AM)));
    expect(results.filter((r) => r.ok)).toHaveLength(business.bookingRules.tablesPerSlot);
    expect(await store.countActive(input.date, input.time)).toBe(business.bookingRules.tablesPerSlot);
  });
});

describe('getBookingStatus', () => {
  it('finds a booking by reference + phone in any format', async () => {
    const store = new MemoryBookingStore();
    const r = await requestBooking(business, store, input, MON_10AM);
    if (!r.ok) throw new Error('setup failed');
    expect((await getBookingStatus(store, r.booking.reference.toLowerCase(), '+971 50 123 4567'))?.status).toBe('PENDING');
    await store.setStatus(r.booking.reference, 'CONFIRMED');
    expect((await getBookingStatus(store, ` ${r.booking.reference} `, '00971501234567'))?.status).toBe('CONFIRMED');
  });

  it('returns null for a wrong phone, exactly like a missing booking', async () => {
    const store = new MemoryBookingStore();
    const r = await requestBooking(business, store, input, MON_10AM);
    if (!r.ok) throw new Error('setup failed');
    expect(await getBookingStatus(store, r.booking.reference, '+971 55 999 9999')).toBeNull();
    expect(await getBookingStatus(store, 'DK-NOPE00', input.phone)).toBeNull();
    expect(await getBookingStatus(store, r.booking.reference, 'garbage')).toBeNull();
  });
});

describe('storage retention', () => {
  it('drops bookings more than 90 days after their date', async () => {
    let now = MON_10AM;
    const store = new MemoryBookingStore(() => now);
    const r = await requestBooking(business, store, input, MON_10AM);
    if (!r.ok) throw new Error('setup failed');
    now = new Date('2027-01-10T00:00:00Z');
    expect(await store.get(r.booking.reference)).not.toBeNull();
    now = new Date('2027-01-13T00:00:00Z');
    expect(await store.get(r.booking.reference)).toBeNull();
  });
});

describe('FileBookingStore', () => {
  it('persists bookings across instances', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mcp-')), 'bookings.json');
    const a = new FileBookingStore(path);
    const r = await requestBooking(business, a, input, MON_10AM);
    if (!r.ok) throw new Error('setup failed');
    await a.setStatus(r.booking.reference, 'CONFIRMED');
    const b = new FileBookingStore(path);
    expect((await b.get(r.booking.reference))?.status).toBe('CONFIRMED');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1);
  });
});
