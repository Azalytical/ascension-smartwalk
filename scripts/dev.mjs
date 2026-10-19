import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { handleApi } from '../src/api.mjs';

const root = resolve(import.meta.dirname, '..');
const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: process.env.OPENAI_MODEL };
const port = Number(process.env.PORT || 8789);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
createServer(async (req, res) => {
  try {
    const chunks = []; let count = 0;
    for await (const chunk of req) { count += chunk.length; if (count > 8192) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    const url = new URL(req.url, `http://localhost:${port}`);
    const request = new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
    const data = JSON.parse(await readFile(resolve(root, 'data/pois.json'), 'utf8'));
    const api = await handleApi(request, env, data);
    if (api) { res.writeHead(api.status, Object.fromEntries(api.headers)); res.end(Buffer.from(await api.arrayBuffer())); return; }
    const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = resolve(root, 'public', path);
    if (!target.startsWith(resolve(root, 'public') + '\\') && !target.startsWith(resolve(root, 'public') + '/')) { res.writeHead(403); res.end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`SmartWalk local preview: http://localhost:${port}`));
