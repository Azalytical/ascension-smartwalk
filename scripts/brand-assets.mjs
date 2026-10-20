// Renders the Aidem PNG icons and the social preview from the SVG sources with Playwright's Chromium.
// Run once after changing the mark: node scripts/brand-assets.mjs
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const brand = resolve(root, 'public/assets/brand/seruen');
const mark = await readFile(resolve(brand, 'mark.svg'), 'utf8');
const maskable = await readFile(resolve(brand, 'mark-maskable.svg'), 'utf8');
const font = (file) => `data:font/woff2;base64,${Buffer.from(file).toString('base64')}`;
const unbounded = font(await readFile(resolve(root, 'node_modules/@fontsource/unbounded/files/unbounded-latin-700-normal.woff2')));
const onestCyr = font(await readFile(resolve(root, 'node_modules/@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2')));
const onestLat = font(await readFile(resolve(root, 'node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2')));
const fonts = `@font-face{font-family:Unbounded;font-weight:700;src:url(${unbounded})}
@font-face{font-family:Onest;font-weight:100 900;src:url(${onestCyr});unicode-range:U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:Onest;font-weight:100 900;src:url(${onestLat})}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
async function shot(html, width, height, file) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><style>${fonts}*{margin:0}html,body{width:${width}px;height:${height}px;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await writeFile(resolve(brand, file), await page.screenshot({ omitBackground: true, type: 'png' }));
}
for (const size of [16, 32, 180, 192, 512]) await shot(mark, size, size, `icon-${size}.png`);
await shot(maskable, 512, 512, 'icon-maskable-512.png');
await shot(maskable, 192, 192, 'icon-maskable-192.png');
// Apple touch icon: full bleed, iOS rounds the corners itself.
await shot(maskable.replace('scale(.78)', 'scale(.86)'), 180, 180, 'apple-touch-icon.png');
const og = `<div style="width:1200px;height:630px;background:#0E1621;color:#F3F5F8;font-family:Onest;display:flex;flex-direction:column;justify-content:space-between;padding:72px 80px;box-sizing:border-box;position:relative;overflow:hidden">
<div style="display:flex;align-items:center;gap:22px"><div style="width:84px;height:84px">${mark}</div><span style="font-family:Unbounded;font-size:56px;letter-spacing:-1px"><span style="color:#F5B700">ai</span>dem</span></div>
<div><div style="font-size:76px;font-weight:700;line-height:1.02;letter-spacing:-2px;max-width:900px">Прогулка по Астане,<br><span style="color:#F5B700">ровно на ваше время.</span></div>
<div style="font-size:30px;color:#B4BCC8;margin-top:28px">ИИ подберёт место рядом и вернёт вас вовремя · Gemini · OpenStreetMap</div></div>
<svg viewBox="0 0 512 512" style="position:absolute;right:-120px;top:-60px;width:620px;height:620px;opacity:.10"><path d="M318 139.5A132 132 0 1 1 194 139.5" fill="none" stroke="#F5B700" stroke-width="44" stroke-linecap="round"/></svg></div>`;
await shot(og, 1200, 630, 'og-1200x630.png');
await browser.close();
console.log('brand assets written');
