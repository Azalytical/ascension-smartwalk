/**
 * Meaning of a free-text request when the ru/kk/en dictionary finds no place category in it, from Gemini embeddings.
 * «Хочу подышать свежим воздухом» names no category, yet it asks for a park. The request is compared with short
 * example requests for each category and with generic requests that name none. The nearest examples decide.
 * Only the request text is sent: never coordinates, never place data. Any failure or timeout means "not understood",
 * and the walk is then picked by the dictionary alone.
 */

export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const DIMENSIONS = 768;
// The first call of an isolate also embeds the examples, so it may take longer than later ones.
const TIMEOUT_MS = 1200;
const FIRST_TIMEOUT_MS = 3000;
const RETRY_MS = 60000;
// The winner must beat the generic examples and stand out from the other categories; a flat profile means "no meaning found".
const LEAD_OVER_GENERIC = 0.02;
const LEAD_OVER_MEDIAN = 0.04;
// A second category is kept only when it is almost as close as the first: «перекусить и выпить кофе».
const SECOND_WITHIN = 0.015;

// Example requests per category, mostly in words the dictionary does not know. `none` holds requests that name nothing.
export const EXAMPLES = {
  park: ['подышать свежим воздухом', 'посидеть на лавочке среди деревьев', 'побыть на природе, где зелено', 'покормить уток у пруда',
    'выгулять собаку', 'take a stroll somewhere green', 'таза ауада болу', 'табиғат аясында демалу'],
  cafe: ['выпить латте или капучино', 'посидеть за чашкой чая', 'перекусить круассаном', 'уютное место посидеть с ноутбуком',
    'grab a cup of tea', 'шай ішіп отыру'],
  museum: ['узнать историю города', 'посмотреть экспонаты и старинные вещи', 'что-то познавательное про Казахстан',
    'learn about local history', 'тарихпен танысу'],
  playground: ['где ребёнок может побегать и полазить', 'горки и качели для малыша', 'swings and slides for kids', 'балаға арналған әткеншек'],
  attraction: ['красивое место для фото', 'главные символы столицы', 'интересная архитектура и виды на город',
    'landmarks to photograph', 'суретке түсетін әдемі жер'],
  restaurant: ['плотно поесть', 'проголодался, где перекусить', 'бешбармак или плов', 'grab a bite', "I'm hungry", 'қарным ашты'],
  mall: ['купить подарок или одежду', 'походить по магазинам', 'buy souvenirs', 'дүкендерді аралау'],
  culture: ['культурная программа вечером', 'послушать живую музыку', 'see a show tonight', 'мәдени демалыс'],
  family: ['развлечения для всей семьи', 'поиграть в боулинг или квест', 'fun activity for the whole family', 'отбасымен көңіл көтеру'],
  nightlife: ['выпить пива или вина', 'потанцевать', 'посидеть с бокалом', 'drinks with friends tonight', 'сыра ішу'],
  none: ['куда сходить рядом', 'что посоветуешь', 'у меня есть свободное время', 'покажи что-нибудь', 'что тут есть поблизости',
    'any ideas nearby', 'не знаю, куда пойти', 'маған кеңес бер'],
};

let cache = null;

/** Clears cached example vectors; for tests. */
export function resetSemanticCache() { cache = null; }

function unit(values) {
  const length = Math.hypot(...values);
  return length > 0 ? values.map(value => value / length) : null;
}

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

async function embed(texts, model, env, fetcher, signal) {
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, {
    method: 'POST', signal,
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: texts.map(text => ({ model: `models/${model}`, content: { parts: [{ text }] },
      taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: DIMENSIONS })) }),
  });
  if (!response.ok) throw new Error(`embedding_${response.status}`);
  const vectors = (await response.json())?.embeddings?.map(item => Array.isArray(item?.values) ? unit(item.values) : null);
  if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some(vector => !vector)) throw new Error('embedding_shape');
  return vectors;
}

/** Category scores: the closest example of each category, highest first. */
export function rankCategories(query, examples) {
  const best = new Map();
  for (const { category, vector } of examples) best.set(category, Math.max(best.get(category) ?? -1, dot(query, vector)));
  return [...best].map(([category, score]) => ({ category, score })).sort((a, b) => b.score - a.score);
}

/** Up to two categories the ranking supports, or none when generic requests are as close or nothing stands out. */
export function pickCategories(ranking) {
  const generic = ranking.find(item => item.category === 'none')?.score ?? -1;
  const places = ranking.filter(item => item.category !== 'none');
  const scores = places.map(item => item.score).sort((a, b) => a - b);
  const median = scores.length ? scores[Math.floor((scores.length - 1) / 2)] : 0;
  const [first, second] = places;
  if (!first || first.score - generic < LEAD_OVER_GENERIC || first.score - median < LEAD_OVER_MEDIAN) return [];
  return second && first.score - second.score <= SECOND_WITHIN && second.score - generic >= LEAD_OVER_GENERIC
    ? [first.category, second.category] : [first.category];
}

/**
 * Categories a request means, from Gemini embeddings, or null when the key is missing or the call fails.
 * Example vectors are fetched once per isolate together with the first request; later requests embed only the query.
 */
export async function semanticCategories(query, env = {}, { fetcher = fetch, now = Date.now(), timeoutMs } = {}) {
  const text = String(query ?? '').trim();
  if (!env.GEMINI_API_KEY || text.length < 3) return null;
  const model = env.GEMINI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  if (cache?.failedAt && now - cache.failedAt < RETRY_MS && cache.model === model) return null;
  let examples = cache?.model === model ? cache.examples : null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? (examples ? TIMEOUT_MS : FIRST_TIMEOUT_MS));
  try {
    let vector;
    if (examples) [vector] = await embed([text], model, env, fetcher, controller.signal);
    else {
      const labelled = Object.entries(EXAMPLES).flatMap(([category, texts]) => texts.map(example => ({ category, text: example })));
      const vectors = await embed([...labelled.map(item => item.text), text], model, env, fetcher, controller.signal);
      vector = vectors.pop();
      examples = labelled.map((item, index) => ({ category: item.category, vector: vectors[index] }));
      cache = { model, examples };
    }
    const ranking = rankCategories(vector, examples);
    return { model, categories: pickCategories(ranking), ranking: ranking.slice(0, 3).map(item => ({ ...item, score: Math.round(item.score * 1000) / 1000 })) };
  } catch {
    if (!cache?.examples) cache = { model, failedAt: now };
    return null;
  } finally { clearTimeout(timer); }
}
