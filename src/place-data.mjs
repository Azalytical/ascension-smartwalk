// Normalize only fields that are present in a source record. Unknown facts remain null.
const lower = value => String(value ?? '').toLocaleLowerCase('ru').normalize('NFKC').replace(/ё/g, 'е').trim();

export function sourceTags(poi) {
  if (poi.tags && !Array.isArray(poi.tags) && typeof poi.tags === 'object') return poi.tags;
  const entries = (Array.isArray(poi.tags) ? poi.tags : String(poi.tags ?? '').split(';'))
    .filter(value => typeof value === 'string' && value.includes('='))
    .map(value => { const at = value.indexOf('='); return [value.slice(0, at).trim(), value.slice(at + 1).trim()]; });
  return Object.fromEntries(entries);
}

function safeLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function instagramLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const url = safeLink(raw) || (/^@?[a-z\d_.]{1,30}$/i.test(raw) ? `https://www.instagram.com/${raw.replace(/^@/, '')}/` : null);
  return url && ['instagram.com', 'www.instagram.com'].includes(new URL(url).hostname.toLowerCase()) ? url : null;
}

function amountOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1000000 ? value : null;
  if (typeof value !== 'string' || !/^\s*\d[\d\s]*(?:[.,]\d{1,2})?\s*(?:KZT|₸|тенге)?\s*$/iu.test(value)) return null;
  const amount = Number(value.replace(/KZT|₸|тенге/giu, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(amount) && amount >= 0 && amount <= 1000000 ? amount : null;
}

export function placeMetadata(poi) {
  const tags = sourceTags(poi);
  const rawCheck = poi.averageCheck ?? poi.average_check ?? tags.average_check ?? tags['payment:average_check'];
  const amount = amountOf(rawCheck && typeof rawCheck === 'object' ? rawCheck.amount : rawCheck);
  const rawCurrency = (rawCheck && typeof rawCheck === 'object' ? rawCheck.currency : null) ?? poi.currency ?? tags.currency;
  const currency = rawCurrency ? String(rawCurrency).trim().toUpperCase()
    : typeof rawCheck === 'string' && /KZT|₸|тенге/iu.test(rawCheck) ? 'KZT' : null;
  const averageCheck = amount !== null && currency ? { amount, currency } : null;
  const rawContacts = poi.contacts && typeof poi.contacts === 'object' ? poi.contacts : {};
  const text = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : null;
  const rating = Number.isFinite(poi.rating) && poi.rating >= 0 ? poi.rating : null;
  const popularity = Number.isFinite(poi.popularity) && poi.popularity >= 0 ? poi.popularity : null;
  const reviewCount = Number.isSafeInteger(poi.reviewCount) && poi.reviewCount >= 0 ? poi.reviewCount : null;
  return {
    averageCheck, rating, popularity, reviewCount,
    contacts: {
      website: safeLink(poi.website ?? rawContacts.website ?? tags['contact:website'] ?? tags.website),
      phone: text(poi.phone ?? rawContacts.phone ?? tags['contact:phone'] ?? tags.phone),
      email: text(poi.email ?? rawContacts.email ?? tags['contact:email'] ?? tags.email),
      instagram: instagramLink(poi.instagram ?? rawContacts.instagram ?? tags['contact:instagram'] ?? tags.instagram),
    },
    openingHours: text(poi.openingHours ?? tags.opening_hours),
    fee: text(poi.fee ?? tags.fee),
    source: text(poi.provenance?.source ?? poi.source) ?? new URL(poi.sourceUrl).hostname,
    sourceLicense: text(poi.license ?? poi.provenance?.license),
  };
}

const CONDITIONS = [
  { key: 'wheelchair', pattern: /коляск|wheelchair|безбарьер|арбамен|арба/iu, label: 'Безбарьерный вход', unknown: 'Безбарьерность входа и всего пути не подтверждена.' },
  { key: 'sockets', pattern: /розет|socket|outlet|заряд|қуат/iu, label: 'Розетки', unknown: 'Наличие доступных посетителю розеток не подтверждено.' },
  { key: 'quiet', pattern: /тих|тишин|quiet|тыныш|спокой/iu, label: 'Тихое место', unknown: 'Тишина и текущий уровень шума не подтверждены.' },
  { key: 'vegan', pattern: /веган|\bvegan\b/iu, label: 'Веганские блюда', unknown: 'Наличие веганских блюд не подтверждено данными заведения.' },
  { key: 'vegetarian', pattern: /вегетариан|\bvegetarian\b/iu, label: 'Вегетарианские блюда', unknown: 'Наличие вегетарианских блюд не подтверждено данными заведения.' },
  { key: 'dogs', pattern: /с\s+собак|с\s+питомц|dog.?friendly|pet.?friendly|with (?:a )?dog|итпен/iu, label: 'Можно с собакой', unknown: 'Возможность посещения с собакой не подтверждена данными места.' },
  { key: 'toilets', pattern: /туалет|санузел|toilet|restroom|дәретхана/iu, label: 'Туалет', unknown: 'Наличие доступного посетителям туалета не подтверждено.' },
  { key: 'interactive', pattern: /интерактив|interactive/iu, label: 'Интерактивные экспозиции', unknown: 'Интерактивные экспозиции не подтверждены источником.' },
];

const OPTIONAL = /желательно|по возможности|если получится|необязатель|не\s+обязатель|предпочита|ideally|if possible|prefer|optional|not (?:required|necessary|essential|needed|necessarily)|мүмкін болса|мүмкіндігінше|болса жақсы|(?:міндетті|қажет|керек)\s+емес/iu;
const MANDATORY = /(?:^|[^\p{L}])(?:обязател(?:ьн\p{L}*|ен)|необходим\p{L}*|нужен|нужна|нужно|нужны|только|строго|must|required|essential|need|needed|міндетті|қажет|керек)(?:[^\p{L}]|$)/iu;
const isMandatory = clause => MANDATORY.test(clause.replace(/не\s+(?:обязател\p{L}*|нуж\p{L}*|требу\p{L}*)|not\s+(?:required|necessary|essential|needed)|(?:do not|don't)\s+need|(?:міндетті|қажет|керек)\s+емес/giu, ''));
// These words describe constraints handled elsewhere, rather than an unsupported amenity.
const HANDLED_WORDS = /^(?:обязательн\p{L}*|необязательн\p{L}*|необходимо|нуж[а-я]*|только|строго|желательн\p{L}*|предпочита\p{L}*|возможност\p{L}*|если|получится|хочу|хотел\p{L}*|мест[а-я]*|наличи\p{L}*|доступ\p{L}*|вход\p{L}*|меню|блюд[а-я]*|ед[а-я]*|питани\p{L}*|поесть|пообед\p{L}*|поужин\p{L}*|перекус\p{L}*|покуш\p{L}*|кафе|кофе\p{L}*|ресторан\p{L}*|парк\p{L}*|музе\p{L}*|театр\p{L}*|погуля\p{L}*|прогул\p{L}*|необычн\p{L}*|интересн\p{L}*|что|то|пешком|минут\p{L}*|мин|час\p{L}*|больш[а-я]*|более|максимум|бюджет\p{L}*|тенге|бесплат\p{L}*|собак\p{L}*|питомц\p{L}*|крышей|помещени\p{L}*|ребен\p{L}*|дет[а-я]*|дожд\p{L}*|меня|мне|для|рядом|сейчас|совсем|немного|просто|please|must|required|essential|ideally|prefer|if|possible|with|without|near|place|menu|food|eat|walk|minutes?|hours?|free|indoor|child|dog|pet|friendly|unusual|something|new|quiet|socket|outlet|toilet|restroom|wheelchair)$/iu;
const CONDITION_CONTEXT_WORDS = /^(?:обязателен|необходим\p{L}*|без|not|any|need|needed|necessary|necessarily|optional|міндетті|қажет|керек|емес|мүмкін|болса|мүмкіндігінше|жақсы|жер|кіру)$/iu;

function conditionClauses(text) {
  return String(text).split(/[.;\n]|\s+(?:но|but|бірақ)\s+/iu).flatMap(sentence => {
    let scope = null;
    return sentence.split(',').flatMap(clause => {
      const parts = clause.trim().split(/\s+(?:и|and|және)\s+/iu);
      const result = [];
      let current = parts.shift() ?? '';
      for (const part of parts) {
        // Explicit modifiers start a new scope; a shared modifier still applies
        // to "желательно тихо и с розеткой" or "обязательно тихо и халяль".
        if (OPTIONAL.test(part) || isMandatory(part)) { result.push(current); current = part; }
        else current += ' и ' + part;
      }
      result.push(current);
      return result.filter(Boolean).map(text => {
        if (isMandatory(text)) scope = true;
        else if (OPTIONAL.test(text)) scope = false;
        return { text, mandatory: scope };
      });
    });
  });
}

function negatedCondition(clause, condition) {
  const normalized = lower(clause);
  const match = condition.pattern.exec(normalized);
  if (!match) return false;
  const before = normalized.slice(0, match.index);
  const after = normalized.slice(match.index + match[0].length);
  // Negative or waived amenities do not become positive requirements. An
  // absent source tag cannot establish that an amenity is absent either.
  return /(?:^|\s)(?:без|не|without|no|not)\s+(?:(?:нуж\p{L}*|требу\p{L}*|надо|хочу|any|a|an|need|needed|want|required|to|have)\s+)*$/iu.test(before)
    || /(?:do not|don't)\s+(?:need|want|require)\s+(?:any\s+)?$/iu.test(before)
    || /^\p{L}*\s+(?:(?:мне|нам|is|are)\s+)?(?:не\s+(?:нуж\p{L}*|требу\p{L}*|надо)|(?:not|isn't|aren't)\s+(?:needed|required|necessary))/iu.test(after)
    || /(?:қажет|керек|міндетті)\s+емес/iu.test(normalized);
}

function unsupportedRemainder(clause) {
  return (lower(clause).match(/[\p{L}]+/gu) ?? []).filter(token => token.length > 2 && !HANDLED_WORDS.test(token) && !CONDITION_CONTEXT_WORDS.test(token)
    && !CONDITIONS.some(condition => condition.pattern.test(token)));
}

export function requestedConditions(text, preferences = '') {
  const clauses = conditionClauses(text);
  const known = CONDITIONS.flatMap(condition => {
    const matches = clauses.filter(clause => condition.pattern.test(clause.text) && !negatedCondition(clause.text, condition));
    if (!matches.length) return [];
    const required = matches.some(clause => clause.mandatory ?? true);
    return [{ key: condition.key, label: condition.label, required, unknown: condition.unknown }];
  });
  const unsupported = new Map(clauses.filter(clause => clause.mandatory && unsupportedRemainder(clause.text).length).map(clause => [clause.text, clause]));
  // Additional unrecognized wishes are visible as caveats even when they are not mandatory.
  for (const clause of conditionClauses(preferences)) {
    if (unsupportedRemainder(clause.text).length) unsupported.set(clause.text, clause);
  }
  return [...known, ...[...unsupported.values()].map((clause, index) => {
    const label = clause.text.trim().slice(0, 120);
    return { key: `unsupported_${index}`, label: `Пожелание: ${label}`, required: Boolean(clause.mandatory),
      unknown: `Пожелание «${label}» не проверено по данным мест.` };
  })];
}

function yes(value, options = []) { return value === true || ['yes', 'true', '1', ...options].includes(lower(value)); }

export function conditionEvidence(poi, key) {
  const tags = sourceTags(poi);
  if (key === 'wheelchair') return yes(poi.wheelchair ?? tags.wheelchair);
  if (key === 'quiet') return yes(poi.quietness ?? tags.quietness ?? tags.quiet, ['quiet', 'low']);
  if (key === 'sockets') return yes(poi.powerSockets ?? tags.power_supply ?? tags.power_socket ?? tags.socket)
    || Object.entries(tags).some(([name, value]) => name.startsWith('socket:') && (yes(value) || /^\d+$/.test(String(value)) && Number(value) > 0));
  if (key === 'vegan') return yes(poi.vegan ?? tags['diet:vegan'], ['only']);
  if (key === 'vegetarian') return yes(poi.vegetarian ?? tags['diet:vegetarian'], ['only']) || yes(poi.vegan ?? tags['diet:vegan'], ['only']);
  if (key === 'dogs') return yes(poi.dogsAllowed ?? tags.dog ?? tags.pets, ['leashed']);
  if (key === 'toilets') return yes(poi.toilets ?? tags.toilets) && !['no', 'private'].includes(lower(tags['toilets:access']));
  if (key === 'interactive') return yes(poi.interactive ?? tags.interactive ?? tags['museum:interactive']);
  return false;
}

export function budgetAssessment(poi, budget, wantsFree) {
  const check = poi.averageCheck;
  const requiresMeal = ['cafe', 'restaurant'].includes(poi.category);
  const free = check?.currency === 'KZT' && check.amount === 0
    || !requiresMeal && ['no', 'free', '0'].includes(lower(poi.fee));
  if ((budget === 0 || wantsFree) && !free) return { allowed: false, status: 'unknown' };
  if (free) return { allowed: true, status: 'free' };
  if (budget === null) return { allowed: true, status: 'not_requested' };
  if (check?.currency === 'KZT') return { allowed: check.amount <= budget, status: 'confirmed' };
  return { allowed: true, status: 'unknown' };
}
