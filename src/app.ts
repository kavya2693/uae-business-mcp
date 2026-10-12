// One web-standard fetch handler for every route. Used by both the local dev server and Vercel.

import { createMcpHandler, originValidationResponse } from '@modelcontextprotocol/server';
import { loadBusiness } from './config.js';
import { getRateLimiter } from './ratelimit.js';
import { getStore } from './storage/index.js';
import { buildServer } from './tools.js';

const business = loadBusiness();
const store = getStore(business);
const rateLimiter = getRateLimiter(`mcp:${business.id}`);

export function clientIp(req: Request | undefined): string {
  const fwd = req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req?.headers.get('x-real-ip') || 'unknown';
}

const mcp = createMcpHandler(() => buildServer({ business, store, rateLimiter, clientKey: clientIp }), {
  onerror: (err) => console.error('[mcp]', err.message),
});

// Browsers send an Origin header; server-to-server clients (Claude, ChatGPT connectors) usually don't.
// Requests without Origin always pass. Browser origins must be listed.
const allowedOrigins = ['localhost', '127.0.0.1', 'claude.ai', 'chatgpt.com', ...(process.env.ALLOWED_ORIGINS ?? '').split(',')]
  .map((s) => s.trim())
  .filter(Boolean);

export const context = { business, store };

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/mcp') {
    return originValidationResponse(request, allowedOrigins) ?? mcp.fetch(request);
  }
  if (path === '/health') {
    return Response.json({ ok: true, business: business.id, storage: store.kind, durable: store.durable });
  }
  if (path === '/') {
    return Response.json({
      name: business.name,
      mcpEndpoint: `${url.origin}/mcp`,
      privacy: `${url.origin}/privacy`,
      note: business.isDemo ? 'Fictional demo business.' : undefined,
    });
  }
  return new Response('Not found', { status: 404 });
}
