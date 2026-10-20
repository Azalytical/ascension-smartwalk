/**
 * Reads event cards from a sxodim.com listing page for Astana (/astana/afisha, /astana/events/<category>).
 * A card links to its event page twice (cover and title), has a category link, then the price, the date, the venue
 * and the address as text. Class names are not used: a card is everything between two links to different event pages,
 * so a change of markup that keeps those links keeps the parser working. Fields are told apart by their content:
 * the date by a month name, the price by «тенге», the address by a street word.
 */

const MONTH = '(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)';
const ONE_DATE = `(?<![\\d:])\\d{1,2}(?:\\s*(?:[-–—]|,|и)\\s*\\d{1,2})*\\s+${MONTH}(?:\\s+\\d{4}(?:\\s*(?:г\\.|года))?)?`;
const DATE = new RegExp(`(?:с\\s+)?${ONE_DATE}(?:\\s*(?:[-–—]|,|и|по|до)\\s*${ONE_DATE})*(?:,?\\s*(?:в|с)\\s+\\d{1,2}:\\d{2}(?:\\s*(?:[-–—]|до)\\s*\\d{1,2}:\\d{2})?)?`, 'iu');
const ONE_PRICE = '(?:от\\s*)?(?<![\\d:])\\d[\\d\\s]*(?:\\s*(?:[-–—]|до)\\s*\\d[\\d\\s]*)?\\s*(?:тенге|теңге|тг\\.?|₸)(?:\\s*\\([^)]*\\))?';
// Several prices in a row stay one field: «от 7000 тенге (взрослый), 3500 тенге (детский, 5-14 лет)».
const PRICE = new RegExp(`${ONE_PRICE}(?:\\s*[,;/]\\s*${ONE_PRICE})*|бесплатн[а-яё]*|тегін`, 'iu');
// Where the address starts: a street word in front («ул.», «пр.», «мкр») or behind («Достық көшесі»), or «Место сбора».
const ADDRESS_START = /^(?:г\.\s*астана|ул\.|ул\s|улица|пр\.|пр-т|просп|проспект|шоссе|ш\.|бульвар|б-р|бул\.|мкр|микрорайон|пер\.|переулок|наб\.|набережная|пл\.|площадь|трасса|ж\.?\s?м\.?\s|жилой массив|место сбора)/iu;
const STREET_AFTER = /\s(?:көшесі|даңғылы|ул\.?|улица|проспект|просп\.?|шоссе|бульвар|переулок)(?:\s|$)/iu;
// Buttons and badges inside a card.
const CHROME = /^(?:билеты|купить билеты?|подробнее|в избранное|читать далее|ещё|еще|рассрочка|0-0-12|kaspi red|бронь|забронировать)$/iu;
const AGE = /^\d{1,2}\+$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bdquo: '„' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
  if (code[0] === '#') { const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : ''; }
  return ENTITIES[code.toLowerCase()] ?? whole;
});
const clean = text => decode(text).replace(/\s+/g, ' ').trim();
const fragments = html => html.split(/<[^>]*>/).map(clean).filter(Boolean);
const HREF = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ALT = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const TITLE = /\stitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const attribute = (tag, pattern) => { const match = tag.match(pattern); return match ? match[1] ?? match[2] : null; };

const EVENT_PATH = /^(?:https?:\/\/(?:www\.)?sxodim\.com)?\/astana\/event\/([a-z0-9][a-z0-9-]{0,200})\/?(?:[?#].*)?$/i;
const CATEGORY_PATH = /^(?:https?:\/\/(?:www\.)?sxodim\.com)?\/astana\/events\/([a-z0-9-]+)\/?$/i;

/** Splits the text of a card into the date, the price, the venue and the address. */
export function splitInfo(parts) {
  const age = parts.find(part => AGE.test(part)) ?? null;
  let text = parts.filter(part => !CHROME.test(part) && !AGE.test(part)).join(', ');
  const date = text.match(DATE);
  if (date) text = text.slice(0, date.index) + ', ' + text.slice(date.index + date[0].length);
  const price = text.match(PRICE);
  if (price) text = text.slice(0, price.index) + ', ' + text.slice(price.index + price[0].length);
  const pieces = text.split(/\s*,\s*/).map(piece => piece.replace(/^[\s·•|–—-]+|[\s·•|–—-]+$/g, '')).filter(Boolean);
  let start = pieces.findIndex(piece => ADDRESS_START.test(piece) || STREET_AFTER.test(` ${piece}`));
  // «Кабанбай батыра 43» without a street word: a name followed by a house number.
  if (start < 0) start = pieces.findIndex((piece, index) => index > 0 && /^[\p{L}.\s-]{3,}\s\d+[\p{L}]?(?:\/\d+)?$/u.test(piece));
  if (start < 0 && pieces.length > 1 && /^\d+[\p{L}]?(?:\/\d+)?$/u.test(pieces.at(-1))) start = pieces.length - 2;
  const venue = (start < 0 ? pieces : pieces.slice(0, start)).join(', ') || null;
  const address = start < 0 ? null : pieces.slice(start).join(', ') || null;
  return { age, dateText: date ? clean(date[0]) : null, price: price ? clean(price[0]).replace(/^./, letter => letter.toLowerCase()) : null, venue, address };
}

/**
 * Event rows { title, category, dateText, venue, address, price, url } in page order, one per event page.
 * Cards without a date are kept with dateText null; the caller decides what to show.
 */
export function parseListing(html) {
  // Only the part of the page with event links is read: the head, scripts and footer can be most of its size.
  const source = String(html || '');
  const first = source.search(/href\s*=\s*["'](?:https?:\/\/(?:www\.)?sxodim\.com)?\/astana\/event\//i);
  if (first < 0) return [];
  const page = source.slice(Math.max(0, source.lastIndexOf('<', first)), source.lastIndexOf('/astana/event/') + 4000)
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const links = [];
  // Only links to event and category pages matter; the closing tag is found by position, not by a pattern.
  for (const match of page.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    if (!tag.includes('/astana/event')) continue;
    const href = decode(attribute(tag, HREF) || '');
    const event = href.match(EVENT_PATH)?.[1]?.toLowerCase() ?? null;
    const isCategory = !event && CATEGORY_PATH.test(href);
    if (!event && !isCategory) continue;
    const close = page.indexOf('</a', match.index + tag.length);
    const end = close < 0 ? match.index + tag.length : page.indexOf('>', close) + 1;
    const inner = page.slice(match.index + tag.length, close < 0 ? match.index + tag.length : close);
    const text = clean(inner.replace(/<[^>]*>/g, ' '));
    const alt = event ? clean(attribute(inner.match(/<img\b[^>]*>/i)?.[0] || '', ALT) || attribute(tag, TITLE) || '') : '';
    links.push({ start: match.index, end, event, category: isCategory ? text : null, text, alt });
  }
  // A card: from the first link to an event page until the first link to another event page.
  const cards = [];
  for (const link of links) {
    if (!link.event) { if (cards.length) cards.at(-1).links.push(link); continue; }
    if (cards.at(-1)?.slug === link.event) { cards.at(-1).links.push(link); continue; }
    cards.push({ slug: link.event, start: link.start, links: [link] });
  }
  const rows = new Map();
  cards.forEach((card, index) => {
    const own = card.links.filter(link => link.event === card.slug);
    const titleLink = own.reduce((best, link) => (link.text.length > best.text.length ? link : best), own[0]);
    const title = titleLink.text.length >= 3 ? titleLink.text : own.map(link => link.alt).find(alt => alt.length >= 3);
    if (!title) return;
    const category = card.links.find(link => link.category)?.category || null;
    // The card's text after the title link, up to the next card or the end of the grid.
    const next = cards[index + 1]?.start ?? page.length;
    let tail = page.slice(titleLink.end, Math.min(next, titleLink.end + 3000));
    // The grid ends at the footer, a heading or the pagination; the cut goes before the whole tag, and a tag cut in half is dropped.
    const stop = tail.search(/<(?:footer|nav|h[1-3])\b|[?&]page=\d/i);
    if (stop >= 0) tail = tail.slice(0, tail.lastIndexOf('<', stop) >= 0 ? tail.lastIndexOf('<', stop) : stop);
    tail = tail.replace(/<[^>]*$/, '');
    const outside = html => fragments(html.replace(/<a\b[\s\S]*?<\/a\s*>/gi, ' ')).filter(part => part !== title && part !== category);
    let info = splitInfo(outside(tail));
    // Another layout: date and place before the title.
    if (!info.dateText) {
      const head = splitInfo(outside(page.slice(card.start, titleLink.start)));
      if (head.dateText) info = head;
    }
    const url = `https://sxodim.com/astana/event/${card.slug}`;
    // An age mark («18+») anywhere on the card stays with the category, where the filter for walks with a child reads it.
    const { age: infoAge, ...fields } = info;
    const age = infoAge ?? outside(page.slice(card.start, next)).find(part => AGE.test(part)) ?? null;
    const row = { title, category: [category, age].filter(Boolean).join(' ') || null, ...fields, url };
    const seen = rows.get(url);
    if (!seen || (!seen.dateText && row.dateText)) rows.set(url, row);
  });
  return [...rows.values()];
}
