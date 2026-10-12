import type { Booking, BookingStatus } from '../booking.js';

export class SlotFullError extends Error {
  constructor() {
    super('That slot just filled up.');
  }
}

export interface BookingStore {
  /** Human-readable driver name, shown on /admin. */
  readonly kind: string;
  /** True when data survives restarts and is shared between server instances. */
  readonly durable: boolean;
  /** Stores a new booking. Throws SlotFullError if the slot already holds `capacity` active bookings. */
  create(booking: Booking, capacity: number): Promise<void>;
  get(reference: string): Promise<Booking | null>;
  /** All bookings, newest first. */
  list(): Promise<Booking[]>;
  setStatus(reference: string, status: BookingStatus): Promise<Booking | null>;
  /** PENDING + CONFIRMED bookings at a slot (DECLINED frees the table). */
  countActive(date: string, time: string): Promise<number>;
}

export const RETENTION_DAYS = 90;
