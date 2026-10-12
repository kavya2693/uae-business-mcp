// Minimal shared HTML shell for /admin and /privacy. No external assets.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const CSS = `
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#0f766e;--danger:#b91c1c;--warn-bg:#fef2f2}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c;--accent:#2dd4bf;--danger:#f87171;--warn-bg:#450a0a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{margin:0 0 4px;font-size:1.6rem}h2{margin-top:2rem;font-size:1.15rem}
.muted{color:var(--muted)}.small{font-size:.85rem}.error{background:var(--warn-bg);color:var(--danger);padding:10px 12px;border-radius:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;gap:12px;align-items:end;flex-wrap:wrap;max-width:420px}
label{display:flex;flex-direction:column;gap:4px;font-size:.9rem;flex:1}input{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
button{font:inherit;font-size:.85rem;padding:6px 12px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}button.danger{background:transparent;color:var(--danger);border-color:var(--danger)}
.row{display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
td.actions{display:flex;gap:6px;flex-wrap:wrap}td.actions form{margin:0}
.badge{font-size:.75rem;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid}.pending{color:#b45309}.confirmed{color:var(--accent)}.declined{color:var(--muted)}
article{max-width:720px}article li{margin:4px 0}a{color:var(--accent)}
`;

export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'referrer-policy': 'same-origin',
    },
  });
}
