// Local development server: wraps the same fetch handler Vercel uses in a plain Node HTTP server.

import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  // No .env: fine for local dev.
}

const { handle } = await import('./src/app.js');
const port = Number(process.env.PORT ?? 3311);
const host = '127.0.0.1'; // MCP spec: local servers should bind to localhost only.

createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'local');
    const request = new Request(`http://${req.headers.host ?? `${host}:${port}`}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Internal error');
  }
}).listen(port, host, () => {
  console.log(`MCP server: http://${host}:${port}/mcp`);
  console.log(`Admin:      http://${host}:${port}/admin`);
  console.log(`Privacy:    http://${host}:${port}/privacy`);
});
