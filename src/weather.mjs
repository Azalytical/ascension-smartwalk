/**
 * Current weather in central Astana from Open-Meteo (free, no key, no visitor data sent).
 * One request per isolate every 15 minutes; any failure means "weather unknown", never a guess.
 */
const SOURCE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=51.1282&longitude=71.4306'
  + '&current=temperature_2m,precipitation,snowfall,weather_code,wind_speed_10m&timezone=UTC';
const FRESH_MS = 15 * 60000;
const RETRY_MS = 2 * 60000;
const TIMEOUT_MS = 1500;
let cache = null;

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Weather for the request, or null when disabled (env.WEATHER !== '1') or unavailable. */
export async function currentWeather(env = {}, fetcher = fetch, now = Date.now()) {
  if (env.WEATHER !== '1') return null;
  if (cache && now - cache.at < (cache.value ? FRESH_MS : RETRY_MS)) return cache.value;
  let value = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(SOURCE_URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (response.ok) {
      const current = (await response.json())?.current;
      const temperatureC = finite(current?.temperature_2m);
      if (current && temperatureC !== null) {
        value = { temperatureC, precipitationMm: finite(current.precipitation) ?? 0, snowfallCm: finite(current.snowfall) ?? 0,
          windKmh: finite(current.wind_speed_10m), code: finite(current.weather_code),
          observedAt: typeof current.time === 'string' ? `${current.time}Z` : null, source: 'Open-Meteo' };
      }
    }
  } catch { value = null; }
  finally { clearTimeout(timer); }
  cache = { at: now, value };
  return value;
}

export function resetWeatherCache() { cache = null; }

// WMO weather interpretation codes used by Open-Meteo.
const RAIN = code => (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
const SNOW = code => (code >= 71 && code <= 77) || code === 85 || code === 86;
const STORM = code => code >= 95;

/** Whether the weather argues for a roof, and how to say it. Thresholds are deliberately conservative. */
export function weatherCondition(weather) {
  if (!weather || typeof weather.temperatureC !== 'number') return null;
  const { temperatureC, precipitationMm = 0, snowfallCm = 0, windKmh = null, code = null } = weather;
  let label = null;
  if (STORM(code)) label = 'гроза';
  else if (snowfallCm > 0 || SNOW(code)) label = 'снег';
  else if (precipitationMm > 0.1 || RAIN(code)) label = 'дождь';
  else if (temperatureC <= -12) label = 'сильный мороз';
  else if (windKmh !== null && windKmh >= 45) label = 'сильный ветер';
  const degrees = `${temperatureC > 0 ? '+' : temperatureC < 0 ? '−' : ''}${Math.abs(Math.round(temperatureC))} °C`;
  return { bad: Boolean(label), label, text: label ? `${degrees}, ${label}` : `${degrees}, без осадков` };
}

// Detailed weather for the agent, MCP tools and /api/weather: feels-like, gusts, sunset and outdoor advice.
// Coordinates are rounded to about 5 km before the request, so a visitor's exact position never leaves Seruen.

const CODES = {
  0: 'ясно', 1: 'почти ясно', 2: 'переменная облачность', 3: 'пасмурно', 45: 'туман', 48: 'туман с изморозью',
  51: 'слабая морось', 53: 'морось', 55: 'сильная морось', 56: 'ледяная морось', 57: 'ледяная морось',
  61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь', 66: 'ледяной дождь', 67: 'ледяной дождь',
  71: 'небольшой снег', 73: 'снег', 75: 'сильный снег', 77: 'снежная крупа', 80: 'ливень', 81: 'ливень', 82: 'сильный ливень',
  85: 'снегопад', 86: 'сильный снегопад', 95: 'гроза', 96: 'гроза с градом', 99: 'гроза с градом'
};
const ASTANA = { lat: 51.13, lon: 71.43 };
const TTL_MS = 15 * 60000;
const detailCache = new Map();

const round = value => Math.round(value * 20) / 20;
const minutesOf = clock => { const [h, m] = String(clock).slice(11, 16).split(':').map(Number); return h * 60 + m; };

/** Outdoor comfort rules for Astana: wind and frost make long outdoor stretches unpleasant. */
export function weatherAdvice(current, now = new Date(), sunset = null) {
  const reasons = [];
  if (current.feelsLike <= -15) reasons.push(`ощущается как ${Math.round(current.feelsLike)}°`);
  if (current.windSpeed >= 10 || current.windGusts >= 15) reasons.push(`ветер ${Math.round(current.windSpeed)} м/с`);
  if (current.precipitation > 0 || [61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82, 85, 86, 95, 96, 99].includes(current.weatherCode)) {
    reasons.push(CODES[current.weatherCode] || 'осадки');
  }
  const advice = { preferIndoor: reasons.length > 0, reasons,
    text: reasons.length ? `Сейчас ${reasons.join(', ')}: лучше места под крышей и короткие отрезки на улице.`
      : 'Погода подходит для прогулки на улице.' };
  if (sunset) {
    const local = new Date(now.getTime() + 5 * 3600000);
    const left = minutesOf(sunset) - (local.getUTCHours() * 60 + local.getUTCMinutes());
    if (left > 0 && left <= 90) advice.darkSoon = `Стемнеет примерно в ${String(sunset).slice(11, 16)}.`;
    if (left <= 0) advice.darkSoon = 'Уже темно: выбирайте освещённые улицы.';
  }
  return advice;
}

export async function astanaWeather({ lat = ASTANA.lat, lon = ASTANA.lon } = {}, { fetchImpl = fetch, now = new Date() } = {}) {
  const at = { lat: round(Number.isFinite(lat) ? lat : ASTANA.lat), lon: round(Number.isFinite(lon) ? lon : ASTANA.lon) };
  const key = `${at.lat},${at.lon}`;
  const hit = detailCache.get(key);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.value;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lon}`
    + '&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,precipitation,weather_code,is_day'
    + '&daily=sunrise,sunset&forecast_days=1&wind_speed_unit=ms&timezone=auto';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': 'Seruen/2.0 (ascension-smartwalk.azamatbreach.workers.dev)' } });
    if (!response.ok) throw new Error(`weather_${response.status}`);
    const body = await response.json();
    const c = body.current || {};
    const current = { temperature: c.temperature_2m, feelsLike: c.apparent_temperature, windSpeed: c.wind_speed_10m, windGusts: c.wind_gusts_10m,
      precipitation: c.precipitation, weatherCode: c.weather_code, description: CODES[c.weather_code] || 'нет описания', isDay: c.is_day === 1 };
    if (!Number.isFinite(current.temperature)) throw new Error('weather_invalid');
    const sunset = body.daily?.sunset?.[0] || null;
    const value = { available: true, ...current, observedAt: c.time || null, sunrise: body.daily?.sunrise?.[0] || null, sunset,
      advice: weatherAdvice(current, now, sunset), area: at, source: 'Open-Meteo', attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)' };
    detailCache.set(key, { at: now.getTime(), value });
    if (detailCache.size > 200) detailCache.delete(detailCache.keys().next().value);
    return value;
  } catch (error) {
    return { available: false, reason: String(error?.message || 'weather_unavailable').slice(0, 60), source: 'Open-Meteo',
      advice: { preferIndoor: false, reasons: [], text: 'Погода сейчас неизвестна: оденьтесь по погоде и проверьте прогноз.' } };
  } finally { clearTimeout(timer); }
}
