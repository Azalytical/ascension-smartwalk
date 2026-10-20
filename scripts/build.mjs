import { readFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, extname, relative, sep } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const assets = {};
const publicRoot = resolve(root, 'public');
const mediaTypes = { '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
for (const [name, type] of [['index.html', 'text/html; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'], ['styles.css', 'text/css; charset=utf-8']]) {
  assets['/' + name] = { body: await readFile(resolve(root, 'public', name), 'utf8'), type };
}
async function collectMedia(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) { await collectMedia(filename); continue; }
    if (!entry.isFile()) continue;
    const extension = extname(filename).toLowerCase();
    const type = mediaTypes[extension];
    if (!type) continue;
    const urlPath = '/' + relative(publicRoot, filename).split(sep).join('/');
    const binary = extension !== '.svg';
    const content = await readFile(filename);
    assets[urlPath] = { body: content.toString(binary ? 'base64' : 'utf8'), type, ...(binary ? { encoding: 'base64' } : {}) };
  }
}
await collectMedia(resolve(publicRoot, 'assets'));
assets['/'] = assets['/index.html'];
const data = JSON.parse(await readFile(resolve(root, 'data/pois.json'), 'utf8'));
const code = `import {handleApi} from './src/api.mjs';
import {prepareDataset} from './src/retrieval.mjs';
export {SocialHub} from './src/social/hub.mjs';
const assets=${JSON.stringify(assets)};
const data=${JSON.stringify(data)};
prepareDataset(data);
export default {async fetch(request,env,ctx){
  const api=await handleApi(request,env,data);if(api)return api;
  const url=new URL(request.url);const asset=assets[url.pathname];
  if(!asset)return new Response('Not found',{status:404});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const body=request.method==='HEAD'?null:asset.encoding==='base64'?Uint8Array.from(atob(asset.body),character=>character.charCodeAt(0)):asset.body;
  return new Response(body,{headers:{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':'public,max-age=120'}});
}};`;
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
await build({ stdin: { contents: code, resolveDir: root, sourcefile: 'smartwalk-worker.mjs' }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, outfile: resolve(root, 'dist/server/index.js') });
await copyFile(resolve(root, '.openai/hosting.json'), resolve(root, 'dist/.openai/hosting.json'));
console.log(JSON.stringify({ built: true, assetCount: Object.keys(assets).length, poiCount: Array.isArray(data) ? data.length : data.pois.length }));
