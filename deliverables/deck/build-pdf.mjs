// PDF презентации с текстовым слоем: каждый слайд печатается отдельно (media screen,
// иначе пропадают картинки), затем страницы склеиваются pdfunite.
// Запуск: node deliverables/deck/build-pdf.mjs [выход.pdf]   (нужны playwright и poppler-utils)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || join(here, '..', 'ascension-smartwalk-presentation.pdf'));
const tmp = mkdtempSync(join(tmpdir(), 'deck-pdf-'));
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.emulateMedia({ media: 'screen' });
await page.goto(pathToFileURL(join(here, 'index.html')).href + '?pdf=1');
await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({ content: '@page{size:1920px 1080px;margin:0}' });
const n = await page.$$eval('.slide', s => s.length);
const parts = [];
for (let i = 0; i < n; i++) {
  await page.evaluate(i => window.deck.show(i, { instant: true, force: true }), i);
  await page.waitForTimeout(250);
  const f = join(tmp, `p${String(i + 1).padStart(2, '0')}.pdf`);
  await page.pdf({ path: f, width: '1920px', height: '1080px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, pageRanges: '1' });
  parts.push(f);
}
await browser.close();
execFileSync('pdfunite', [...parts, out]);
rmSync(tmp, { recursive: true, force: true });
console.log(`${n} слайдов → ${out}`);
