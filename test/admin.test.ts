import { beforeEach, describe, expect, it } from 'vitest';
import { handleAdmin, isValidSession, makeSessionToken } from '../src/admin.js';
import { requestBooking } from '../src/booking.js';
import { loadBusiness } from '../src/config.js';
import { MemoryRateLimiter } from '../src/ratelimit.js';
import { MemoryBookingStore } from '../src/storage/memory.js';

const business = loadBusiness();
const BASE = 'http://127.0.0.1:3311';
let store: MemoryBookingStore;
let deps: Parameters<typeof handleAdmin>[2];

const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(BASE + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
const call = (req: Request) => handleAdmin(req, new URL(req.url).pathname, deps);

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'correct horse';
  store = new MemoryBookingStore();
  deps = { business, store, rateLimiter: new MemoryRateLimiter(), clientIp: () => '1.1.1.1' };
});

describe('session tokens', () => {
  it('accepts a fresh token and rejects tampered, expired or wrong-password tokens', () => {
    const t = makeSessionToken('pw', 0);
    expect(isValidSession('pw', t, 1000)).toBe(true);
    expect(isValidSession('other', t, 1000)).toBe(false);
    expect(isValidSession('pw', t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), 1000)).toBe(false);
    expect(isValidSession('pw', t, 9 * 3600 * 1000)).toBe(false);
    expect(isValidSession('pw', undefined)).toBe(false);
  });
});

describe('/admin', () => {
  it('is disabled without ADMIN_PASSWORD', async () => {
    delete process.env.ADMIN_PASSWORD;
    expect((await call(new Request(BASE + '/admin'))).status).toBe(503);
  });

  it('shows a login form and never lists bookings without a session', async () => {
    const r = await requestBooking(business, store, { name: 'Secret Guest', phone: '0501234567', date: '2026-10-13', time: '19:30', partySize: 2 }, new Date('2026-10-12T06:00:00Z'));
    expect(r.ok).toBe(true);
    const html = await (await call(new Request(BASE + '/admin'))).text();
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Secret Guest');
  });

  it('rejects a wrong password', async () => {
    const res = await call(post('/admin/login', { password: 'nope' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('locks login after 5 attempts from one IP', async () => {
    for (let i = 0; i < 5; i++) await call(post('/admin/login', { password: 'nope' }));
    const html = await (await call(post('/admin/login', { password: 'correct horse' }))).text();
    expect(html).toContain('Too many attempts');
  });

  it('rejects a cross-site login post', async () => {
    expect((await call(post('/admin/login', { password: 'correct horse' }, { origin: 'https://evil.example' }))).status).toBe(403);
  });

  it('logs in, lists, confirms, declines and deletes bookings (with HTML escaped)', async () => {
    const r = await requestBooking(business, store, { name: '<script>alert(1)</script>', phone: '0501234567', date: '2026-10-13', time: '19:30', partySize: 2 }, new Date('2026-10-12T06:00:00Z'));
    if (!r.ok) throw new Error('setup');
    const ref = r.booking.reference;

    const login = await call(post('/admin/login', { password: 'correct horse' }));
    expect(login.status).toBe(303);
    const cookie = login.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const auth = { cookie: cookie.split(';')[0] };

    const html = await (await call(new Request(BASE + '/admin', { headers: auth }))).text();
    expect(html).toContain(ref);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');

    await call(post(`/admin/bookings/${ref}`, { action: 'confirm' }, auth));
    expect((await store.get(ref))?.status).toBe('CONFIRMED');
    await call(post(`/admin/bookings/${ref}`, { action: 'decline' }, auth));
    expect((await store.get(ref))?.status).toBe('DECLINED');
    await call(post(`/admin/bookings/${ref}`, { action: 'delete' }, auth));
    expect(await store.get(ref)).toBeNull();
  });

  it('refuses booking actions without a session or from another site', async () => {
    const r = await requestBooking(business, store, { name: 'Guest', phone: '0501234567', date: '2026-10-13', time: '19:30', partySize: 2 }, new Date('2026-10-12T06:00:00Z'));
    if (!r.ok) throw new Error('setup');
    const ref = r.booking.reference;
    expect((await call(post(`/admin/bookings/${ref}`, { action: 'confirm' }))).status).toBe(303);
    const cookie = { cookie: `admin_session=${makeSessionToken('correct horse')}` };
    expect((await call(post(`/admin/bookings/${ref}`, { action: 'confirm' }, { ...cookie, origin: 'https://evil.example' }))).status).toBe(403);
    expect((await store.get(ref))?.status).toBe('PENDING');
  });
});
