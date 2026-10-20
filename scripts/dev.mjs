import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { handleApi } from '../src/api.mjs';
import { localSocialHub } from '../src/social/local.mjs';
import { localWatchPush } from '../src/watch-push.mjs';

const root = resolve(import.meta.dirname, '..');
// SMARTWALK_PRODUCTION=1 (set in the Dockerfile for Cloud Run) listens on all interfaces and enforces the request budget.
const production = process.env.SMARTWALK_PRODUCTION === '1';
const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: process.env.OPENAI_MODEL,
  ...(production ? { MEMORY_BUDGET: true } : { LOCAL_DEVELOPMENT: true }),
  // Friends and meetups: SQLite file in SOCIAL_DB (or in memory), the same store the Durable Object uses.
  SOCIAL_LOCAL: localSocialHub(process.env.SOCIAL_DB || ':memory:'),
  // Watch reminders: the same Durable Object class with storage in memory.
  WATCH_PUSH_LOCAL: localWatchPush() };
const port = Number(process.env.PORT || 8789);
const host = process.env.HOST || '127.0.0.1';
const dataset = JSON.parse(await readFile(resolve(root, 'data/places.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
createServer(async (req, res) => {
  try {
    const chunks = []; let count = 0;
    // Photos for /api/vision are the only large bodies.
    const limit = req.url.startsWith('/api/vision') ? 1500000 : req.url.startsWith('/mcp') ? 65536 : 8192;
    for await (const chunk of req) { count += chunk.length; if (count > limit) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    // Behind Cloud Run the public origin comes from Host and X-Forwarded-Proto; the API compares it with Origin.
    const proto = production && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const url = new URL(req.url, `${proto}://${req.headers.host || `localhost:${port}`}`);
    const request = new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
    const api = await handleApi(request, env, dataset);
    if (api) { res.writeHead(api.status, Object.fromEntries(api.headers)); res.end(Buffer.from(await api.arrayBuffer())); return; }
    const path = url.pathname === '/' ? 'index.html' : url.pathname === '/watch' ? 'watch.html' : url.pathname === '/agent' ? 'agent.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = resolve(root, 'public', path);
    if (!target.startsWith(resolve(root, 'public') + '\\') && !target.startsWith(resolve(root, 'public') + '/')) { res.writeHead(403); res.end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, host, () => console.log(`SmartWalk ${production ? 'server' : 'local preview'}: http://${host}:${port}`));
