import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from '../src/ratelimit.js';

describe('MemoryRateLimiter', () => {
  it('allows 5 requests per phone per 10 minutes, then blocks', async () => {
    let t = 0;
    const rl = new MemoryRateLimiter(600, () => t);
    for (let i = 0; i < 5; i++) expect((await rl.check(['phone:501234567'])).ok).toBe(true);
    const blocked = await rl.check(['phone:501234567']);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await rl.check(['phone:559999999'])).ok).toBe(true);
    t = 601_000;
    expect((await rl.check(['phone:501234567'])).ok).toBe(true);
  });

  it('allows 20 per IP so guests sharing an IP are not blocked by each other', async () => {
    const rl = new MemoryRateLimiter(600, () => 0);
    for (let i = 0; i < 20; i++) expect((await rl.check(['ip:1.2.3.4', `phone:50000000${i % 10}${i}`])).ok).toBe(true);
    expect((await rl.check(['ip:1.2.3.4', 'phone:551111111'])).ok).toBe(false);
  });

  it('does not count a blocked request against the other keys', async () => {
    const rl = new MemoryRateLimiter(600, () => 0);
    for (let i = 0; i < 5; i++) await rl.check(['ip:9.9.9.9', 'phone:501234567']);
    await rl.check(['ip:9.9.9.9', 'phone:501234567']); // blocked by phone
    for (let i = 0; i < 15; i++) expect((await rl.check(['ip:9.9.9.9', `phone:52${i}`])).ok).toBe(true);
  });
});
