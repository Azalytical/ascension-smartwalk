// What a spoken or typed request says about time: how long («3 часа», «два с половиной часа») and whether the person
// comes back («только туда», «туда и обратно»). No browser APIs here, so the tests read it as it is.

// The longest walk the app plans, as on the server (src/retrieval.mjs MAX_MINUTES).
export const MAX_MINUTES = 240;

const WORD_NUMBERS = {
  'десять': 10, 'пятнадцать': 15, 'двадцать': 20, 'двадцать пять': 25, 'тридцать': 30, 'сорок': 40, 'сорок пять': 45, 'пятьдесят': 50, 'шестьдесят': 60, 'девяносто': 90,
  'ten': 10, 'fifteen': 15, 'twenty': 20, 'thirty': 30, 'forty': 40, 'forty five': 45, 'fifty': 50, 'sixty': 60, 'ninety': 90,
  'он': 10, 'он бес': 15, 'жиырма': 20, 'отыз': 30, 'қырық': 40, 'қырық бес': 45, 'елу': 50, 'алпыс': 60, 'тоқсан': 90,
};
const HOUR_WORDS = { 'один': 1, 'одного': 1, 'два': 2, 'двух': 2, 'три': 3, 'трёх': 3, 'трех': 3, 'четыре': 4, 'четырёх': 4, 'четырех': 4,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'бір': 1, 'екі': 2, 'үш': 3, 'төрт': 4 };
const numberWords = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join('|');
const hourWords = Object.keys(HOUR_WORDS).join('|');
const hours = (word) => HOUR_WORDS[word.toLowerCase()] ?? Number(word);

// The first rule that matches decides; the longer forms («2 часа 30 минут», «два с половиной часа») go first.
const RULES = [
  [/(?<![\d.,])(\d)\s*(?:час\S*|ч|h(?:ours?)?|сағат\S*)\s+(?:и\s+|and\s+)?(\d{1,2})\s*(?:мин\S*|min\S*)/i, (m) => Number(m[1]) * 60 + Number(m[2])],
  [new RegExp(`(?:на\\s+|for\\s+)?(?<![\\d.,])(${hourWords}|\\d)\\s+(?:с\\s+половиной\\s+час\\S*|and\\s+a\\s+half\\s+hours?|жарым\\s+сағат\\S*)`, 'i'), (m) => hours(m[1]) * 60 + 30],
  [/(?:на\s+)?полтора\s+час\S*|(?:an?\s+)?hour\s+and\s+a\s+half|1[.,]5\s*(?:час\S*|h(?:ours?)?|сағат\S*)/i, () => 90],
  [/(?:на\s+)?полчаса|half\s+an\s+hour|жарты\s+сағат\S*/i, () => 30],
  [/(?:на\s+|for\s+)?(\d{1,3})\s*(?:-?\s*(?:мин\S*|min\S*|минут\S*))/i, (m) => Number(m[1])],
  [new RegExp(`(?:на\\s+|for\\s+)?(${numberWords})\\s+(?:мин\\S*|min\\S*)`, 'i'), (m) => WORD_NUMBERS[m[1].toLowerCase()]],
  // «2,5 часа», «3.5 h»: a half hour after the comma or the point.
  [/(?:на\s+|for\s+)?(?<![\d.,])(\d)(?:[.,](\d))?\s*(?:час\S*|h(?:ours?)?\b|сағат\S*)/i, (m) => Math.round(Number(`${m[1]}.${m[2] || 0}`) * 60)],
  [new RegExp(`(?:на\\s+|for\\s+)?(${hourWords})\\s+(?:час\\S*|hours?|сағат\\S*)`, 'i'), (m) => HOUR_WORDS[m[1].toLowerCase()] * 60],
  [/(?:на\s+|for\s+)?(?:an?\s+)?(?<!\p{L})(?:час|hour|сағат)(?!\p{L})/iu, () => 60],
];

// «Только туда»: the walk ends at the place. «В одну сторону» alone is left out: «15 минут в одну сторону» is about the way there.
const ONE_WAY = /(?<!\p{L})(?:только\s+туда|только\s+в\s+одну\s+сторону|в\s+один\s+конец|без\s+(?:возвращения|возврата|обратной\s+дороги|дороги\s+обратно)|не\s+возвращаясь|(?:обратно|назад)\s+не\s+(?:пойду|пойдём|пойдем|вернусь|вернёмся|вернемся|надо|нужно)|one[\s-]way(?:\s+only)?|no\s+way\s+back|not\s+coming\s+back|тек\s+(?:бару\S*|бір\s+бағыт\S*)|қайтпай\S*|қайтусыз)(?!\p{L})/iu;
const ROUND_TRIP = /(?<!\p{L})(?:туда\s+и\s+обратно|с\s+возвращением|round[\s-]trip|there\s+and\s+back|барып[\s-]қайт\S*)(?!\p{L})/iu;

const cut = (text, match) => `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;

/**
 * Pulls the time out of a request: "на час, кофе и парк" -> { minutes: 60, oneWay: null, query: "кофе и парк" },
 * "3 часа у меги, только туда" -> { minutes: 180, oneWay: true, query: "у меги" }. oneWay is null when the phrase does not say.
 */
export function understand(text) {
  let query = String(text || '').replace(/\s+/g, ' ').trim();
  let minutes = null;
  for (const [pattern, value] of RULES) {
    const match = pattern.exec(query);
    if (!match) continue;
    const found = value(match);
    if (Number.isFinite(found) && found >= 10 && found <= MAX_MINUTES) {
      minutes = found;
      query = cut(query, match);
    }
    break;
  }
  let oneWay = null;
  const one = ONE_WAY.exec(query);
  const round = one ? null : ROUND_TRIP.exec(query);
  if (one || round) { oneWay = Boolean(one); query = cut(query, one || round); }
  query = query.trim().replace(/^(?:(?:у меня|i have|менде|а|ну|тогда|давай(?:те)?|and|so|well|ал|енді)(?:\s+|$))+/i, '').replace(/\s+([,.!?])/g, '$1').replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, '').replace(/\s+/g, ' ').trim();
  return { minutes, oneWay, query };
}
