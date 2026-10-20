// Voice input: say "час, кофе и парк" and the walk is planned at once.
// The browser's own recognition gives live text where it works; elsewhere (Firefox, in-app browsers, iPhone
// home-screen apps) the phrase is recorded, turned into a 16 kHz WAV and written down by Gemini on the server.
import { lang } from './i18n.js';

const RECOGNITION_LANG = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' };
const MAX_RECORDING_MS = 12000;

// ---------- understanding the phrase ----------
const WORD_NUMBERS = {
  'десять': 10, 'пятнадцать': 15, 'двадцать': 20, 'двадцать пять': 25, 'тридцать': 30, 'сорок': 40, 'сорок пять': 45, 'пятьдесят': 50, 'шестьдесят': 60, 'девяносто': 90,
  'ten': 10, 'fifteen': 15, 'twenty': 20, 'thirty': 30, 'forty': 40, 'forty five': 45, 'fifty': 50, 'sixty': 60, 'ninety': 90,
  'он': 10, 'он бес': 15, 'жиырма': 20, 'отыз': 30, 'қырық': 40, 'қырық бес': 45, 'елу': 50, 'алпыс': 60, 'тоқсан': 90,
};
const HOUR_WORDS = { 'один': 1, 'одного': 1, 'два': 2, 'двух': 2, 'три': 3, 'one': 1, 'two': 2, 'three': 3, 'бір': 1, 'екі': 2, 'үш': 3 };
const numberWords = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join('|');
const hourWords = Object.keys(HOUR_WORDS).join('|');

const RULES = [
  [/(?:на\s+)?полтора\s+час\S*|(?:an?\s+)?hour\s+and\s+a\s+half|бір\s+жарым\s+сағат\S*|1[.,]5\s*(?:час\S*|h(?:ours?)?|сағат\S*)/i, () => 90],
  [/(?:на\s+)?полчаса|half\s+an\s+hour|жарты\s+сағат\S*/i, () => 30],
  [/(?:на\s+|for\s+)?(\d{1,3})\s*(?:-?\s*(?:мин\S*|min\S*|минут\S*))/i, (m) => Number(m[1])],
  [new RegExp(`(?:на\\s+|for\\s+)?(${numberWords})\\s+(?:мин\\S*|min\\S*)`, 'i'), (m) => WORD_NUMBERS[m[1].toLowerCase()]],
  [/(?:на\s+|for\s+)?(\d)\s*(?:час\S*|h(?:ours?)?\b|сағат\S*)/i, (m) => Number(m[1]) * 60],
  [new RegExp(`(?:на\\s+|for\\s+)?(${hourWords})\\s+(?:час\\S*|hours?|сағат\\S*)`, 'i'), (m) => HOUR_WORDS[m[1].toLowerCase()] * 60],
  [/(?:на\s+|for\s+)?(?:an?\s+)?(?<!\p{L})(?:час|hour|сағат)(?!\p{L})/iu, () => 60],
];

/** Pulls the time budget out of a spoken or typed request: "на час, кофе и парк" -> { minutes: 60, query: "кофе и парк" }. */
export function understand(text) {
  let query = String(text || '').replace(/\s+/g, ' ').trim();
  let minutes = null;
  for (const [pattern, value] of RULES) {
    const match = pattern.exec(query);
    if (!match) continue;
    const found = value(match);
    if (Number.isFinite(found) && found >= 10 && found <= 180) {
      minutes = found;
      query = (query.slice(0, match.index) + ' ' + query.slice(match.index + match[0].length));
    }
    break;
  }
  query = query.replace(/^(?:у меня|i have|менде)\s+/i, '').replace(/\s+([,.!?])/g, '$1').replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, '').replace(/\s+/g, ' ').trim();
  return { minutes, query };
}

// ---------- listening ----------
export const canListen = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition || (navigator.mediaDevices?.getUserMedia && window.MediaRecorder));

/**
 * Starts listening. Calls onState('listening' | 'thinking' | 'idle'), onText(partial) while words arrive,
 * then resolves with the final phrase ('' when nothing was heard). stop() ends the phrase early.
 */
export function startListening({ onState = () => {}, onText = () => {} } = {}) {
  let stopper = () => {};
  let cancelled = false;
  const promise = (async () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      const result = await recognize(Recognition, onState, onText, (fn) => { stopper = fn; });
      if (result.ok || cancelled) return result.text;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported');
    return record(onState, (fn) => { stopper = fn; });
  })().finally(() => onState('idle'));
  return { promise, stop: () => { cancelled = true; stopper(); } };
}

function recognize(Recognition, onState, onText, setStop) {
  return new Promise((resolve) => {
    const recognition = new Recognition();
    recognition.lang = RECOGNITION_LANG[lang()] || 'ru-RU';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    let text = '';
    let failed = null;
    recognition.onresult = (event) => { text = [...event.results].map((item) => item[0].transcript).join(' ').trim(); onText(text); };
    recognition.onerror = (event) => { failed = event.error; };
    recognition.onend = () => {
      // "not-allowed" and "service-not-allowed" happen in iPhone home-screen apps; recording still works there.
      const fallback = failed && !['no-speech', 'aborted'].includes(failed);
      resolve({ ok: !fallback, text });
    };
    setStop(() => recognition.stop());
    onState('listening');
    try { recognition.start(); } catch { resolve({ ok: false, text: '' }); }
  });
}

async function record(onState, setStop) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((item) => MediaRecorder.isTypeSupported?.(item)) || '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  setStop(stop);
  const silence = watchSilence(stream, stop);
  const limit = setTimeout(stop, MAX_RECORDING_MS);
  recorder.start(250);
  onState('listening');
  await stopped;
  clearTimeout(limit);
  silence();
  stream.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
  if (blob.size < 1200) return '';
  onState('thinking');
  const wav = await toWav(blob).catch(() => null);
  const audio = await base64(wav || blob);
  const response = await fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, mimeType: wav ? 'audio/wav' : blob.type, lang: lang() }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'listen_failed');
  return data.text || '';
}

// Stops the recording 1.4 s after the person stops talking (once they have said something).
function watchSilence(stream, stop) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return () => {};
  const context = new Context();
  context.resume?.().catch(() => {});
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let spoke = false;
  let quietSince = 0;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    const now = performance.now();
    if (level > 0.035) { spoke = true; quietSince = now; }
    else if (spoke && now - quietSince > 1400) stop();
  }, 100);
  return () => { clearInterval(timer); context.close().catch(() => {}); };
}

// Any recording the browser can decode becomes 16 kHz mono 16-bit WAV, which both Gemini and OpenAI accept.
async function toWav(blob) {
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true));
    return new Blob([view.buffer], { type: 'audio/wav' });
  } finally { context.close().catch(() => {}); }
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
