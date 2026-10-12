import { Redis } from '@upstash/redis';
import type { Booking, BookingStatus } from '../booking.js';
import { toInstant } from '../time.js';
import { RETENTION_DAYS, SlotFullError, type BookingStore } from './types.js';

// Atomically: refuse if the slot is at capacity, otherwise store the booking and index it.
// KEYS: booking, slot set, refs index. ARGV: capacity, json, ttlSeconds, ref, createdAtMs
const CREATE_SCRIPT = `
if redis.call('SCARD', KEYS[2]) >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('SADD', KEYS[2], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[4])
return 1
`;

/** Production store on Upstash Redis. Each booking expires RETENTION_DAYS after its date. */
export class UpstashBookingStore implements BookingStore {
  readonly kind = 'upstash';
  readonly durable = true;

  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
    private readonly timeZone: string,
  ) {}

  private bookingKey = (ref: string) => `${this.namespace}:booking:${ref}`;
  private slotKey = (date: string, time: string) => `${this.namespace}:slot:${date}T${time}`;
  private refsKey = () => `${this.namespace}:refs`;

  private ttlSeconds(b: Booking): number {
    const expires = toInstant(this.timeZone, b.date, b.time).getTime() + RETENTION_DAYS * 86400000;
    return Math.max(60, Math.ceil((expires - Date.now()) / 1000));
  }

  async create(booking: Booking, capacity: number): Promise<void> {
    const ok = await this.redis.eval(
      CREATE_SCRIPT,
      [this.bookingKey(booking.reference), this.slotKey(booking.date, booking.time), this.refsKey()],
      [String(capacity), JSON.stringify(booking), String(this.ttlSeconds(booking)), booking.reference, String(Date.parse(booking.createdAt))],
    );
    if (Number(ok) !== 1) throw new SlotFullError();
  }

  async get(reference: string): Promise<Booking | null> {
    return (await this.redis.get<Booking>(this.bookingKey(reference))) ?? null;
  }

  async list(): Promise<Booking[]> {
    const refs = await this.redis.zrange<string[]>(this.refsKey(), 0, 499, { rev: true });
    if (refs.length === 0) return [];
    const rows = await this.redis.mget<(Booking | null)[]>(...refs.map(this.bookingKey));
    const expired = refs.filter((_, i) => !rows[i]);
    if (expired.length) await this.redis.zrem(this.refsKey(), ...expired);
    return rows.filter((b): b is Booking => !!b);
  }

  async setStatus(reference: string, status: BookingStatus): Promise<Booking | null> {
    const b = await this.get(reference);
    if (!b) return null;
    const updated: Booking = { ...b, status, updatedAt: new Date().toISOString() };
    await this.redis.set(this.bookingKey(reference), updated, { keepTtl: true });
    const slot = this.slotKey(b.date, b.time);
    if (status === 'DECLINED') await this.redis.srem(slot, reference);
    else {
      await this.redis.sadd(slot, reference);
      await this.redis.expire(slot, this.ttlSeconds(b));
    }
    return updated;
  }

  async countActive(date: string, time: string): Promise<number> {
    return this.redis.scard(this.slotKey(date, time));
  }
}
