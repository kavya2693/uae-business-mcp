// Booking request validation, UAE phone normalisation and reference generation.

import type { Business } from './config.js';
import { checkAvailability, checkRequestRules, type AvailableSlot, type ProblemDetail } from './availability.js';
import { SlotFullError, type BookingStore } from './storage/types.js';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

export interface Booking {
  reference: string;
  businessId: string;
  status: BookingStatus;
  name: string;
  /** E.164, e.g. +971501234567 */
  phone: string;
  date: string;
  time: string;
  partySize: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookingInput {
  name: string;
  phone: string;
  date: string;
  time: string;
  partySize: number;
  notes?: string;
}

/**
 * Normalises a UAE phone number to E.164 (+971...).
 * Accepts +971 / 00971 / 971 / leading-0 national forms, with spaces, dashes, dots or brackets.
 * Mobiles: 50, 52, 54, 55, 56, 58 + 7 digits. Landlines: area code 2, 3, 4, 6, 7 or 9 + 7 digits.
 */
export function normalizeUaePhone(input: string): { ok: true; e164: string; kind: 'mobile' | 'landline' } | { ok: false } {
  const compact = input.trim().replace(/[\s\-.()]/g, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false };
  let national: string;
  if (compact.startsWith('+971')) national = compact.slice(4);
  else if (compact.startsWith('00971')) national = compact.slice(5);
  else if (compact.startsWith('971') && compact.length >= 11) national = compact.slice(3);
  else if (compact.startsWith('0')) national = compact.slice(1);
  else return { ok: false };
  national = national.replace(/^0/, ''); // tolerate "+971 (0)50 ..."
  if (/^5[024568]\d{7}$/.test(national)) return { ok: true, e164: `+971${national}`, kind: 'mobile' };
  if (/^[234679]\d{7}$/.test(national)) return { ok: true, e164: `+971${national}`, kind: 'landline' };
  return { ok: false };
}

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export function generateReference(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${[...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
}

export function normalizeReference(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, '');
}

export type BookingProblemCode = ProblemDetail['code'] | 'INVALID_NAME' | 'INVALID_PHONE' | 'NOTES_TOO_LONG';

export type BookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; code: BookingProblemCode; message: string; alternativeSlots: AvailableSlot[] };

/** Validates input fields that don't depend on time or capacity. */
export function validateGuestFields(input: BookingInput): { code: BookingProblemCode; message: string } | null {
  const name = input.name?.trim() ?? '';
  if (name.length < 2 || name.length > 80) return { code: 'INVALID_NAME', message: 'Guest name must be 2-80 characters.' };
  if (!normalizeUaePhone(input.phone ?? '').ok) {
    return {
      code: 'INVALID_PHONE',
      message: 'Phone must be a UAE number, e.g. +971 50 123 4567 (mobile) or +971 4 123 4567 (landline). Ask the guest for a UAE number.',
    };
  }
  if ((input.notes ?? '').length > 500) return { code: 'NOTES_TOO_LONG', message: 'Notes must be 500 characters or fewer.' };
  return null;
}

/** Validates and stores a PENDING booking request. Never confirms anything. */
export async function requestBooking(
  business: Business,
  store: BookingStore,
  input: BookingInput,
  now: Date = new Date(),
): Promise<BookingResult> {
  const fieldProblem = validateGuestFields(input);
  if (fieldProblem) return { ok: false, ...fieldProblem, alternativeSlots: [] };

  const req = { date: input.date, time: input.time, partySize: input.partySize };
  const rulesProblem = checkRequestRules(business, req, now);
  const availability = await checkAvailability(business, req, (d, t) => store.countActive(d, t), now);
  if (rulesProblem || !availability.requestedSlotAvailable) {
    const problem = rulesProblem ?? availability.problem!;
    return { ok: false, code: problem.code, message: problem.message, alternativeSlots: availability.slots };
  }

  const phone = normalizeUaePhone(input.phone);
  const stamp = now.toISOString();
  const booking: Booking = {
    reference: generateReference(business.bookingRules.referencePrefix),
    businessId: business.id,
    status: 'PENDING',
    name: input.name.trim(),
    phone: phone.ok ? phone.e164 : input.phone,
    date: input.date,
    time: input.time,
    partySize: input.partySize,
    notes: (input.notes ?? '').trim(),
    createdAt: stamp,
    updatedAt: stamp,
  };
  try {
    await store.create(booking, business.bookingRules.tablesPerSlot);
  } catch (err) {
    if (!(err instanceof SlotFullError)) throw err;
    const retry = await checkAvailability(business, req, (d, t) => store.countActive(d, t), now);
    return { ok: false, code: 'SLOT_FULL', message: `No tables are left at ${req.time} on ${req.date}.`, alternativeSlots: retry.slots };
  }
  return { ok: true, booking };
}

/** Looks a booking up by reference AND phone. A wrong phone looks exactly like a missing booking. */
export async function getBookingStatus(store: BookingStore, reference: string, phone: string): Promise<Booking | null> {
  const booking = await store.get(normalizeReference(reference));
  const normalized = normalizeUaePhone(phone);
  if (!booking || !normalized.ok || normalized.e164 !== booking.phone) return null;
  return booking;
}
