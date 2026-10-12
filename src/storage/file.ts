import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Booking } from '../booking.js';
import { MemoryBookingStore } from './memory.js';

/** Local development store: a JSON file that survives restarts. Single process only. */
export class FileBookingStore extends MemoryBookingStore {
  override readonly kind = 'file';
  override readonly durable = true;
  private readonly path: string;

  constructor(path = 'data/bookings.json', now?: () => Date) {
    super(now);
    this.path = resolve(process.cwd(), path);
    try {
      const rows = JSON.parse(readFileSync(this.path, 'utf8')) as Booking[];
      for (const b of rows) this.bookings.set(b.reference, b);
    } catch {
      // No file yet: start empty.
    }
  }

  protected override async persist(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.bookings.values()], null, 2));
    renameSync(tmp, this.path);
  }
}
