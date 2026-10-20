import { readFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, extname, relative, sep } from 'node:path';
import { build } from 'esbuild';
import { preparePublic } from './prepare-public.mjs';
import { venueIndexData } from '../src/events-venues.mjs';

const root = resolve(import.meta.dirname, '..');
const publicRoot = resolve(root, 'public');
const prepared = await preparePublic();
const textTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const binaryTypes = { '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' };
const skip = new Set(['sw.template.js']);
const assets = {};
// Everything under public/ is served as is: the app shell, ES modules, styles, vendored MapLibre and fonts, icons, data.
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) { await collect(filename); continue; }
    if (!entry.isFile() || skip.has(entry.name)) continue;
    const extension = extname(filename).toLowerCase();
    const urlPath = '/' + relative(publicRoot, filename).split(sep).join('/');
    if (textTypes[extension]) assets[urlPath] = { body: await readFile(filename, 'utf8'), type: textTypes[extension] };
    else if (binaryTypes[extension]) assets[urlPath] = { body: (await readFile(filename)).toString('base64'), type: binaryTypes[extension], encoding: 'base64' };
  }
}
await collect(publicRoot);
assets['/'] = assets['/index.html'];
if (assets['/watch.html']) assets['/watch'] = assets['/watch.html'];
if (assets['/friends.html']) assets['/friends'] = assets['/friends.html'];
if (assets['/agent.html']) assets['/agent'] = assets['/agent.html'];
const data = JSON.parse(await readFile(resolve(root, 'data/places.json'), 'utf8'));
// Venue names and addresses for placing city events, worked out here so the Worker does not spend its CPU budget on them.
const venues = venueIndexData(Array.isArray(data) ? data : data.pois);
const code = `import {handleApi,prepareApi} from './src/api.mjs';
import {prepareDataset} from './src/retrieval.mjs';
import {prepareCityEvents,refreshCityEvents} from './src/events-live.mjs';
export {SocialHub} from './src/social/hub.mjs';
export {WatchPush} from './src/watch-push.mjs';
export {CityEventsStore} from './src/events-live.mjs';
const assets=${JSON.stringify(assets)};
const data=${JSON.stringify(data)};
prepareDataset(data);
prepareApi(data);
prepareCityEvents(data,${JSON.stringify(venues)});
const cacheFor=path=>path==='/'||path.endsWith('.html')||path==='/watch'||path==='/friends'||path==='/agent'||path==='/sw.js'?'no-cache':path.startsWith('/vendor/')||path.startsWith('/assets/')?'public,max-age=86400':'public,max-age=120';
// Bodies are decoded once per isolate and reused, which keeps each request well under the CPU limit.
const decoded=new Map();
const bytesOf=(path,asset)=>{let bytes=decoded.get(path);if(!bytes){if(asset.encoding==='base64'){const text=atob(asset.body);bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);}else bytes=new TextEncoder().encode(asset.body);decoded.set(path,bytes);}return bytes;};
export default {async fetch(request,env,ctx){
  const api=await handleApi(request,env,data);if(api)return api;
  const url=new URL(request.url);const asset=assets[url.pathname];
  if(!asset)return new Response('Not found',{status:404});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const body=request.method==='HEAD'?null:bytesOf(url.pathname,asset);
  return new Response(body,{headers:{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':cacheFor(url.pathname)}});
},
// Cron Trigger (wrangler.jsonc): today's collection of the sxodim.com listing.
async scheduled(controller,env,ctx){ctx.waitUntil(refreshCityEvents(env));}};`;
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
await build({ stdin: { contents: code, resolveDir: root, sourcefile: 'smartwalk-worker.mjs' }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, outfile: resolve(root, 'dist/server/index.js') });
await copyFile(resolve(root, '.openai/hosting.json'), resolve(root, 'dist/.openai/hosting.json'));
console.log(JSON.stringify({ built: true, assetCount: Object.keys(assets).length, poiCount: Array.isArray(data) ? data.length : data.pois.length, browsePlaces: prepared.placeCount, buildId: prepared.buildId }));
