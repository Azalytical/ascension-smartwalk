// Reads the pitch speech (speech-10min.md, written for Alisher and Daniyar) into what the prompter shows:
// slides with their time windows and speaker, the text cut into pieces at the stage directions [в скобках],
// the fallback notes (> …), the bonus after slide 07, the short version, the «if something broke» list and the jury Q&A.
// The format is the one the speech thread writes; if a heading changes, the prompter still shows the raw text.
import { readFileSync } from 'node:fs';

const SLIDE = /^###\s+(\d{2})\s+·\s+(.+?)\s+·\s+(\d+:\d{2})\s*[–-]\s*(\d+:\d{2})\s+·\s+(.+?)\s*$/;
const BONUS = /^####\s+(.+)$/;
const toSec = (text) => { const [m, s] = text.split(':').map(Number); return m * 60 + s; };

function tableRows(lines) {
  return lines.filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .map((line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
}

export function parseSpeech(file) {
  const md = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = md.split('\n');
  const title = (lines.find((line) => line.startsWith('# ')) || '# Aidem').slice(2).trim();
  const sections = [];
  let section = null;
  for (const line of lines) {
    if (line.startsWith('## ')) { section = { title: line.slice(3).trim(), lines: [] }; sections.push(section); continue; }
    if (section) section.lines.push(line);
  }
  const find = (re) => sections.find((s) => re.test(s.title));

  const slides = [];
  const bySlides = find(/^Речь по слайдам/);
  let slide = null;
  let target = null;
  for (const raw of bySlides ? bySlides.lines : []) {
    const line = raw.trim();
    const head = line.match(SLIDE);
    if (head) {
      slide = { n: Number(head[1]), title: head[2], from: toSec(head[3]), to: toSec(head[4]), speaker: head[5], screen: '', items: [], bonus: null };
      slides.push(slide);
      target = slide.items;
      continue;
    }
    if (!slide || !line) continue;
    const bonus = line.match(BONUS);
    if (bonus) { slide.bonus = { title: bonus[1].trim(), items: [] }; target = slide.bonus.items; continue; }
    if (/^Жирным выделены/.test(line)) continue;
    const screen = line.match(/^\*На экране:\*\s*(.+)$/);
    if (screen) { slide.screen = screen[1]; continue; }
    const dir = line.match(/^\*\[(.+)\]\*$/);
    if (dir) { target.push({ type: 'dir', text: dir[1].trim() }); continue; }
    if (line.startsWith('>')) { target.push({ type: 'note', text: line.replace(/^>\s?/, '') }); continue; }
    target.push({ type: 'text', text: line });
  }

  const bullets = (s) => (s ? s.lines.map((l) => l.trim()).filter((l) => /^(\d+\.|-)\s/.test(l)).map((l) => l.replace(/^(\d+\.|-)\s+/, '')) : []);
  const qa = tableRows((find(/^Вопросы жюри/) || { lines: [] }).lines).slice(1).map(([q, who, a]) => ({ q, who, a })).filter((row) => row.q && row.a);
  const shortSection = find(/^Короткая версия/);
  return {
    title,
    file,
    slides,
    end: slides.length ? slides[slides.length - 1].to : 510,
    morning: bullets(find(/^Утром/)),
    beforeStage: bullets(find(/^За две минуты/)),
    short: { intro: shortSection ? shortSection.lines.map((l) => l.trim()).find((l) => l && !/^\d+\./.test(l)) || '' : '', items: bullets(shortSection) },
    broken: bullets(find(/^Если что-то сломалось/)),
    qa,
  };
}
