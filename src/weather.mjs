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
