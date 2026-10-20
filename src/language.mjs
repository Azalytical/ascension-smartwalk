/**
 * Is a model's text in the language the visitor asked in? Gemini sometimes slips Russian phrases into a Kazakh or
 * English answer («… is close, около 10 минут пешком»), because the place data it reads is in Russian.
 * Place names and «quoted» text are left out before counting, so a Russian name in an English answer is fine.
 */

// Russian words a Kazakh sentence does not use. Words Kazakh shares («минут», «парк», «кафе», «музей», «от», «там») are left out.
const RUSSIAN_ONLY = new Set(('и в во на не что это как для или но до по из за с со к у об же бы вы вас вам ваш ваша ваше ваши '
  + 'около пешком рядом можно нужно есть если уже ещё еще очень будет туда обратно сейчас вернётесь вернетесь идти дорога дорогу '
  + 'займёт займет также тоже где когда здесь только место места мест минуты часа часов открыто погода прогулка прогулки '
  + 'прогулку лучше хватит успеете путь потом после затем источник источника источнику данным подходит под ближайший ближайшее '
  + 'недалеко далеко время времени останется зайти посмотреть').split(' '));

const words = (text, pattern) => text.match(pattern) ?? [];
const CYRILLIC = /[а-яёәғқңөұүһі]+(?:-[а-яёәғқңөұүһі]+)*/giu;
const LATIN = /[a-z]{3,}/gi;

/**
 * Why `text` is not in `language` ('ru', 'kk' or 'en'), or null when it is. `names` are place names it may quote as is.
 * English: two or more Cyrillic words. Kazakh: two or more Russian-only words. Russian or Kazakh: mostly Latin words.
 */
export function languageProblem(text, language, names = []) {
  let rest = String(text || '').replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' ');
  for (const name of names) if (name) rest = rest.split(name).join(' ');
  // A declined name («у Поющих фонтанов») still counts as the name: words sharing their first four letters are skipped.
  const stems = new Set(names.filter(Boolean).flatMap(name => words(name.toLowerCase(), CYRILLIC).concat(words(name.toLowerCase(), LATIN)))
    .filter(word => word.length >= 4).map(word => word.slice(0, 4)));
  const own = word => word.length >= 4 && stems.has(word.toLowerCase().slice(0, 4));
  const cyrillic = words(rest, CYRILLIC).filter(word => word.length >= 2 && !own(word));
  const latin = words(rest, LATIN).filter(word => !own(word));
  if (language === 'en') return cyrillic.length >= 2 ? `cyrillic: ${cyrillic.slice(0, 4).join(' ')}` : null;
  if (latin.length >= 4 && latin.length > 0.3 * (latin.length + cyrillic.length)) return `latin: ${latin.slice(0, 4).join(' ')}`;
  if (language === 'kk') {
    const russian = cyrillic.filter(word => RUSSIAN_ONLY.has(word.toLowerCase()));
    if (russian.length >= 2) return `russian: ${russian.slice(0, 4).join(' ')}`;
  }
  return null;
}

/** The reason Gemini gets back with a rejected text, in the instruction language. */
export const languageNote = language => `весь текст должен быть на языке answerLanguage = ${language}${language === 'ru' ? '' : ' без русских слов и фраз'}; `
  + 'названия мест можно оставить как есть';
