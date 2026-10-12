// /admin: password-protected booking list with confirm / decline / delete.
// Auth: ADMIN_PASSWORD env var → signed, expiring, HttpOnly SameSite=Strict cookie.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { Business } from './config.js';
import type { BookingStatus } from './booking.js';
import type { RateLimiter } from './ratelimit.js';
import type { BookingStore } from './storage/types.js';
import { escapeHtml, page } from './html.js';

const COOKIE = 'admin_session';
const SESSION_SECONDS = 8 * 3600;

function sign(password: string, payload: string): string {
  return createHmac('sha256', password).update(`admin-session:v1:${payload}`).digest('hex');
}

function sameSecret(a: string, b: string): boolean {
  // Hash first so lengths always match and timing does not leak length.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export function makeSessionToken(password: string, nowMs = Date.now()): string {
  const exp = String(Math.floor(nowMs / 1000) + SESSION_SECONDS);
  return `${exp}.${sign(password, exp)}`;
}

export function isValidSession(password: string, token: string | undefined, nowMs = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) * 1000 < nowMs) return false;
  return sameSecret(sig, sign(password, exp));
}

function readCookie(req: Request, name: string): string | undefined {
  return req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

/** Blocks cross-site form posts: a browser POST must come from this same origin. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function loginPage(business: Business, error?: string): Response {
  return page(
    `${business.name} · Admin`,
    `<h1>Bookings admin</h1>
     <p class="muted">${escapeHtml(business.name)}</p>
     ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
     <form method="post" action="/admin/login" class="card">
       <label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
       <button type="submit">Sign in</button>
     </form>`,
    error ? 401 : 200,
  );
}

const STATUS_ORDER: Record<BookingStatus, number> = { PENDING: 0, CONFIRMED: 1, DECLINED: 2 };

async function listPage(business: Business, store: BookingStore): Promise<Response> {
  const bookings = (await store.list()).sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
  );
  const pending = bookings.filter((b) => b.status === 'PENDING').length;
  const warning = store.durable
    ? ''
    : `<p class="error">Storage is "${escapeHtml(store.kind)}": bookings are NOT kept between restarts or shared between server instances. Configure Upstash before real use.</p>`;
  const rows = bookings
    .map((b) => {
      const ref = escapeHtml(b.reference);
      const act = (action: string, label: string, cls = '') =>
        `<form method="post" action="/admin/bookings/${encodeURIComponent(b.reference)}"><input type="hidden" name="action" value="${action}"><button class="${cls}" type="submit">${label}</button></form>`;
      const actions = [
        b.status !== 'CONFIRMED' ? act('confirm', 'Confirm') : '',
        b.status !== 'DECLINED' ? act('decline', 'Decline', 'secondary') : '',
        act('delete', 'Delete', 'danger'),
      ].join('');
      return `<tr>
        <td><code>${ref}</code></td>
        <td><span class="badge ${b.status.toLowerCase()}">${b.status}</span></td>
        <td>${escapeHtml(b.date)} ${escapeHtml(b.time)}</td>
        <td>${b.partySize}</td>
        <td>${escapeHtml(b.name)}</td>
        <td><a href="tel:${escapeHtml(b.phone)}">${escapeHtml(b.phone)}</a></td>
        <td>${escapeHtml(b.notes) || '<span class="muted">—</span>'}</td>
        <td class="actions">${actions}</td>
      </tr>`;
    })
    .join('');
  return page(
    `${business.name} · Admin`,
    `<header class="row"><div><h1>Bookings</h1><p class="muted">${escapeHtml(business.name)} · ${pending} pending · storage: ${escapeHtml(store.kind)}</p></div>
       <form method="post" action="/admin/logout"><button class="secondary" type="submit">Sign out</button></form></header>
     ${warning}
     ${
       bookings.length
         ? `<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Status</th><th>When</th><th>Guests</th><th>Name</th><th>Phone</th><th>Notes</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
         : '<p class="muted">No booking requests yet.</p>'
     }
     <p class="muted small">Delete permanently removes a booking, e.g. when a guest asks for their data to be erased. Bookings are deleted automatically 90 days after their date.</p>`,
  );
}

export async function handleAdmin(
  req: Request,
  path: string,
  deps: { business: Business; store: BookingStore; rateLimiter: RateLimiter; clientIp: (r: Request) => string },
): Promise<Response> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return page('Admin disabled', '<h1>Admin is disabled</h1><p>Set the ADMIN_PASSWORD environment variable to enable it.</p>', 503);

  const secure = new URL(req.url).protocol === 'https:';
  const cookieAttrs = `Path=/admin; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

  if (path === '/admin/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
    const limited = await deps.rateLimiter.check([`login:${deps.clientIp(req)}`]);
    if (!limited.ok) return loginPage(deps.business, `Too many attempts. Try again in ${Math.ceil(limited.retryAfterSeconds / 60)} minutes.`);
    const form = await req.formData();
    if (!sameSecret(String(form.get('password') ?? ''), password)) return loginPage(deps.business, 'Wrong password.');
    return redirect('/admin', `${COOKIE}=${makeSessionToken(password)}; Max-Age=${SESSION_SECONDS}; ${cookieAttrs}`);
  }

  const authed = isValidSession(password, readCookie(req, COOKIE));
  if (!authed) return path === '/admin' && req.method === 'GET' ? loginPage(deps.business) : redirect('/admin');

  if (path === '/admin/logout' && req.method === 'POST') {
    return redirect('/admin', `${COOKIE}=; Max-Age=0; ${cookieAttrs}`);
  }

  const match = path.match(/^\/admin\/bookings\/([A-Z0-9-]+)$/);
  if (match && req.method === 'POST') {
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
    const action = String((await req.formData()).get('action'));
    const ref = match[1];
    if (action === 'confirm') await deps.store.setStatus(ref, 'CONFIRMED');
    else if (action === 'decline') await deps.store.setStatus(ref, 'DECLINED');
    else if (action === 'delete') await deps.store.delete(ref);
    else return new Response('Unknown action', { status: 400 });
    return redirect('/admin');
  }

  if (path === '/admin' && req.method === 'GET') return listPage(deps.business, deps.store);
  return new Response('Not found', { status: 404 });
}
