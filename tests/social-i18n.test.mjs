// The «Друзья» tab in Kazakh and English: every string it looks up exists in all three languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document ??= { documentElement: {} };
const { t, plural, setLang } = await import('../public/js/core/i18n.js');
await import('../public/js/social/strings.js');

const source = readFileSync(new URL('../public/js/social/strings.js', import.meta.url), 'utf8');
const dictionary = name => {
  const body = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`))[1];
  return new Map([...body.matchAll(/'(sx\.[^']+)': '((?:[^'\\]|\\.)*)'/g)].map(([, key, value]) => [key, value]));
};
const ru = dictionary('ru'), kk = dictionary('kk'), en = dictionary('en');
const screens = ['screens.js', 'service.js', 'map-layer.js'].map(file => readFileSync(new URL(`../public/js/social/${file}`, import.meta.url), 'utf8')).join('\n');

test('the friends tab has every Russian string in Kazakh and English, and no Russian text left in its code', () => {
  assert.ok(ru.size > 250);
  assert.deepEqual([...ru.keys()].filter(key => !kk.has(key)), []);
  assert.deepEqual([...ru.keys()].filter(key => !en.has(key)), []);
  for (const key of new Set([...screens.matchAll(/t\('(sx\.[^']+)'/g)].map(match => match[1]))) assert.ok(en.has(key) && kk.has(key), key);
  // The watch is Russian only, so the English hint quotes its two buttons as they are.
  assert.deepEqual([...en].filter(([key, value]) => key !== 'sx.watch.openAfter' && /[А-Яа-яЁё]/.test(value)).map(([key]) => key), []);
  const code = screens.split('\n').filter(line => !line.trim().startsWith('//')).map(line => line.replace(/\s\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(code, /[А-Яа-яЁё]/);
});

test('switching the language switches the friends tab strings and plurals', () => {
  setLang('en');
  assert.equal(t('sx.meetupsCount', { n: 2 }), 'Meetups · 2');
  assert.equal(plural(3, 'sx.w.friend'), 'friends');
  setLang('kk');
  assert.equal(t('sx.title'), 'Достар');
  setLang('ru');
  assert.equal(plural(3, 'sx.w.friend'), 'друга');
  assert.equal(t('sx.title'), 'Друзья');
});
