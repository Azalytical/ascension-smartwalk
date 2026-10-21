// «Какие данные использованы»: the cell drawn on the map is exactly the set of points the server cannot tell apart,
// and the panel and the privacy lines it adds exist in Russian, Kazakh and English.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cellBox, outbound } from '../public/js/core/privacy.js';
import { haversineMeters } from '../src/retrieval.mjs';

test('the box drawn on the map holds every point that reaches the server as the same cell, about 110 × 70 m', () => {
  const exact = { kind: 'gps', lat: 51.090712, lon: 71.418345 };
  const ring = cellBox(exact);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  const [[west, south], , [east, north]] = ring;
  const sent = outbound(exact);
  assert.ok(west < exact.lon && exact.lon < east && south < exact.lat && exact.lat < north, 'the exact point is inside its box');
  assert.ok(west < sent.lon && sent.lon < east && south < sent.lat && sent.lat < north, 'so is the point the server got');
  // Any other point in the box goes out as the same point.
  for (const [lon, lat] of [[west + 1e-6, south + 1e-6], [east - 1e-6, north - 1e-6], [(west + east) / 2, north - 1e-6]]) {
    assert.deepEqual(outbound({ kind: 'gps', lat, lon }), sent);
  }
  const tall = haversineMeters(south, west, north, west);
  const wide = haversineMeters(south, west, south, east);
  assert.ok(tall > 105 && tall < 115, `north–south ${tall} m`);
  assert.ok(wide > 65 && wide < 75, `west–east ${wide} m`);
});

test('the data panel and the privacy lines have every string in Russian, Kazakh and English', () => {
  for (const file of ['../public/js/ui/data-used.js', '../public/js/tabs/me.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    // The strings are the object literal passed to addStrings: read it as data, without loading the page modules.
    const start = source.indexOf('addStrings({') + 'addStrings('.length;
    const strings = new Function(`return ${source.slice(start, source.indexOf('\n});', start) + 2)}`)();
    const block = name => new Map(Object.entries(strings[name]));
    const ru = block('ru'), kk = block('kk'), en = block('en');
    assert.ok(ru.size >= 3, file);
    assert.deepEqual([...ru.keys()].filter(key => !kk.has(key)), [], `${file}: Kazakh`);
    assert.deepEqual([...ru.keys()].filter(key => !en.has(key)), [], `${file}: English`);
    assert.deepEqual([...en].filter(([, value]) => /[А-Яа-яЁё]/.test(value)).map(([key]) => key), [], `${file}: no Russian left in English`);
    for (const key of new Set([...source.matchAll(/t\('((?:du|me|privacy)\.[A-Za-z.]+)'/g)].map(match => match[1]))) {
      if (key.startsWith('du.') || ru.has(key)) assert.ok(ru.has(key) && kk.has(key) && en.has(key), `${file}: ${key}`);
    }
  }
});
