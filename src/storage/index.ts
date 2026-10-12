import { Redis } from '@upstash/redis';
import type { Business } from '../config.js';
import { FileBookingStore } from './file.js';
import { MemoryBookingStore } from './memory.js';
import type { BookingStore } from './types.js';
import { upstashCredentials } from '../upstash-env.js';
import { UpstashBookingStore } from './upstash.js';

let store: BookingStore | undefined;

/** Upstash when configured; otherwise a local file (default) or memory (STORAGE=memory). */
export function getStore(business: Business): BookingStore {
  if (store) return store;
  const { STORAGE, VERCEL } = process.env;
  const creds = upstashCredentials();
  if (creds) {
    store = new UpstashBookingStore(new Redis(creds), `mcp:${business.id}`, business.timezone);
  } else if (STORAGE === 'memory' || VERCEL) {
    // Vercel's filesystem is read-only and per-instance, so a file store cannot work there.
    store = new MemoryBookingStore();
  } else {
    store = new FileBookingStore();
  }
  return store;
}

export type { BookingStore } from './types.js';
