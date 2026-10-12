// Rate limiting for request_booking: in-memory locally, Upstash in production.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface RateLimiter {
  /** Counts one hit against every key; fails if any key is over its limit. */
  check(keys: string[]): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>;
}

export const WINDOW_SECONDS = 600;
/** Requests per window, by key prefix. Per-IP is looser because many guests can share one IP (office NAT, connector servers). */
export const LIMITS: Record<string, number> = { phone: 5, ip: 20 };
const limitFor = (key: string) => LIMITS[key.split(':')[0]] ?? 5;

/** Sliding window over timestamps held in memory. Per process only. */
export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly windowSeconds = WINDOW_SECONDS,
    private readonly now: () => number = Date.now,
  ) {}

  async check(keys: string[]) {
    const t = this.now();
    const from = t - this.windowSeconds * 1000;
    let retryAfter = 0;
    for (const key of keys) {
      const recent = (this.hits.get(key) ?? []).filter((x) => x > from);
      this.hits.set(key, recent);
      if (recent.length >= limitFor(key)) retryAfter = Math.max(retryAfter, Math.ceil((recent[0] - from) / 1000));
    }
    if (retryAfter > 0) return { ok: false as const, retryAfterSeconds: retryAfter };
    for (const key of keys) this.hits.get(key)!.push(t);
    return { ok: true as const };
  }
}

export class UpstashRateLimiter implements RateLimiter {
  private readonly byPrefix = new Map<string, Ratelimit>();

  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  private limiterFor(key: string): Ratelimit {
    const kind = key.split(':')[0];
    let rl = this.byPrefix.get(kind);
    if (!rl) {
      rl = new Ratelimit({ redis: this.redis, limiter: Ratelimit.slidingWindow(limitFor(key), `${WINDOW_SECONDS} s`), prefix: `${this.prefix}:${kind}` });
      this.byPrefix.set(kind, rl);
    }
    return rl;
  }

  async check(keys: string[]) {
    const results = await Promise.all(keys.map((k) => this.limiterFor(k).limit(k)));
    const blocked = results.filter((r) => !r.success);
    if (blocked.length === 0) return { ok: true as const };
    const reset = Math.max(...blocked.map((r) => r.reset));
    return { ok: false as const, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  }
}

let limiter: RateLimiter | undefined;

export function getRateLimiter(namespace: string): RateLimiter {
  if (limiter) return limiter;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  limiter = url && token ? new UpstashRateLimiter(new Redis({ url, token }), `${namespace}:ratelimit`) : new MemoryRateLimiter();
  return limiter;
}
