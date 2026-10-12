import { Redis } from '@upstash/redis';
import type { Business } from '../config.js';
import { FileBookingStore } from './file.js';
import { MemoryBookingStore } from './memory.js';
import type { BookingStore } from './types.js';
import { UpstashBookingStore } from './upstash.js';

let store: BookingStore | undefined;

/** Upstash when configured; otherwise a local file (default) or memory (STORAGE=memory). */
export function getStore(business: Business): BookingStore {
  if (store) return store;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, STORAGE, VERCEL } = process.env;
  if (url && token) {
    store = new UpstashBookingStore(new Redis({ url, token }), `mcp:${business.id}`, business.timezone);
  } else if (STORAGE === 'memory' || VERCEL) {
    // Vercel's filesystem is read-only and per-instance, so a file store cannot work there.
    store = new MemoryBookingStore();
  } else {
    store = new FileBookingStore();
  }
  return store;
}

export type { BookingStore } from './types.js';
