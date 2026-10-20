// Generated files the browser app needs next to public/: vendored MapLibre and fonts, the compact place list,
// the opening-hours parser shared with the server, and the offline demo answers. Used by both build.mjs and dev.mjs; outputs are gitignored.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { preparedPlaces } from '../src/retrieval.mjs';
import { demoAnswers } from './demo-answers.mjs';

const root = resolve(import.meta.dirname, '..');
const pub = resolve(root, 'public');
const modules = resolve(root, 'node_modules');

const copies = [
  ['maplibre-gl/dist/maplibre-gl.mjs', 'vendor/maplibre/maplibre-gl.mjs'],
  ['maplibre-gl/dist/maplibre-gl-worker.mjs', 'vendor/maplibre/maplibre-gl-worker.mjs'],
  ['maplibre-gl/dist/maplibre-gl.css', 'vendor/maplibre/maplibre-gl.css'],
  ['@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2', 'vendor/fonts/onest-cyrillic.woff2'],
  ['@fontsource-variable/onest/files/onest-cyrillic-ext-wght-normal.woff2', 'vendor/fonts/onest-cyrillic-ext.woff2'],
  ['@fontsource-variable/onest/files/onest-latin-wght-normal.woff2', 'vendor/fonts/onest-latin.woff2'],
  ['@fontsource-variable/onest/files/onest-latin-ext-wght-normal.woff2', 'vendor/fonts/onest-latin-ext.woff2'],
  ['@fontsource/unbounded/files/unbounded-latin-700-normal.woff2', 'vendor/fonts/unbounded-latin-700.woff2'],
];

export async function preparePublic() {
  for (const [from, to] of copies) {
    await mkdir(resolve(pub, to, '..'), { recursive: true });
    await copyFile(resolve(modules, from), resolve(pub, to));
  }
  await mkdir(resolve(pub, 'js/lib'), { recursive: true });
  await copyFile(resolve(root, 'src/hours.mjs'), resolve(pub, 'js/lib/hours.mjs'));

  const dataset = JSON.parse(await readFile(resolve(root, 'data/places.json'), 'utf8'));
  // Compact rows for the browse layer: [id, name, category, lat, lon, openingHours, phone, website, wheelchair, source, address].
  const rows = preparedPlaces(dataset).map(p => [String(p.id), p.name, p.category, +p.lat.toFixed(6), +p.lon.toFixed(6),
    p.openingHours || null, p.phone || null, p.website || null, p.wheelchair || null, p.source?.label || null, p.address || null]);
  const places = { source: 'OpenStreetMap, Overture Maps', license: 'ODbL-1.0, CDLA-Permissive-2.0', count: rows.length,
    updatedAt: (Array.isArray(dataset) ? dataset[0]?.retrievedAt : dataset.retrievedAt) || null,
    fields: ['id', 'name', 'category', 'lat', 'lon', 'openingHours', 'phone', 'website', 'wheelchair', 'source', 'address'], rows };
  await mkdir(resolve(pub, 'data'), { recursive: true });
  const body = JSON.stringify(places);
  await writeFile(resolve(pub, 'data/places.json'), body);
  // Saved answers for the key scenarios, for when there is no internet.
  await writeFile(resolve(pub, 'data/demo-answers.json'), JSON.stringify(demoAnswers(dataset)));

  // The service worker's cache name changes with every build so a deploy replaces the old shell.
  const buildId = createHash('sha256').update(body + Date.now()).digest('hex').slice(0, 10);
  const sw = await readFile(resolve(pub, 'sw.template.js'), 'utf8');
  await writeFile(resolve(pub, 'sw.js'), sw.replaceAll('__BUILD_ID__', buildId));
  return { buildId, placeCount: rows.length };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await preparePublic()));
