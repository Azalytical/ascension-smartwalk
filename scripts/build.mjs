import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const assets = {};
for (const [name, type] of [['index.html', 'text/html; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'], ['styles.css', 'text/css; charset=utf-8']]) {
  assets['/' + name] = { body: await readFile(resolve(root, 'public', name), 'utf8'), type };
}
assets['/'] = assets['/index.html'];
const data = JSON.parse(await readFile(resolve(root, 'data/pois.json'), 'utf8'));
const code = `import {handleApi} from './src/api.mjs';
const assets=${JSON.stringify(assets)};
const data=${JSON.stringify(data)};
export default {async fetch(request,env,ctx){
  const api=await handleApi(request,env,data);if(api)return api;
  const url=new URL(request.url);const asset=assets[url.pathname];
  if(!asset)return new Response('Not found',{status:404});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':'public,max-age=120'}});
}};`;
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
await build({ stdin: { contents: code, resolveDir: root, sourcefile: 'smartwalk-worker.mjs' }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, outfile: resolve(root, 'dist/server/index.js') });
await copyFile(resolve(root, '.openai/hosting.json'), resolve(root, 'dist/.openai/hosting.json'));
console.log(JSON.stringify({ built: true, poiCount: Array.isArray(data) ? data.length : data.pois.length }));
