import type { Booking, BookingStatus } from '../booking.js';
import { RETENTION_DAYS, SlotFullError, type BookingStore } from './types.js';

const isActive = (b: Booking) => b.status !== 'DECLINED';

/** Keeps bookings in process memory. Lost on restart; not shared between serverless instances. */
export class MemoryBookingStore implements BookingStore {
  readonly kind: string = 'memory';
  readonly durable: boolean = false;
  protected bookings = new Map<string, Booking>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  protected purgeExpired(): boolean {
    const cutoff = new Date(this.now().getTime() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
    let changed = false;
    for (const [ref, b] of this.bookings) {
      if (b.date < cutoff) {
        this.bookings.delete(ref);
        changed = true;
      }
    }
    return changed;
  }

  protected async persist(): Promise<void> {}

  private countActiveSync(date: string, time: string): number {
    let n = 0;
    for (const b of this.bookings.values()) if (b.date === date && b.time === time && isActive(b)) n++;
    return n;
  }

  async create(booking: Booking, capacity: number): Promise<void> {
    // Check and insert with no await in between, so concurrent requests cannot overbook.
    if (this.countActiveSync(booking.date, booking.time) >= capacity) throw new SlotFullError();
    this.bookings.set(booking.reference, { ...booking });
    await this.persist();
  }

  async get(reference: string): Promise<Booking | null> {
    if (this.purgeExpired()) await this.persist();
    const b = this.bookings.get(reference);
    return b ? { ...b } : null;
  }

  async list(): Promise<Booking[]> {
    if (this.purgeExpired()) await this.persist();
    return [...this.bookings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({ ...b }));
  }

  async setStatus(reference: string, status: BookingStatus): Promise<Booking | null> {
    const b = this.bookings.get(reference);
    if (!b) return null;
    b.status = status;
    b.updatedAt = this.now().toISOString();
    await this.persist();
    return { ...b };
  }

  async delete(reference: string): Promise<boolean> {
    const existed = this.bookings.delete(reference);
    if (existed) await this.persist();
    return existed;
  }

  async countActive(date: string, time: string): Promise<number> {
    return this.countActiveSync(date, time);
  }
}
