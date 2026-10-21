// Voice input: say "час, кофе и парк" and the walk is planned at once.
// The browser's own recognition gives live text where it works; elsewhere (Firefox, in-app browsers, iPhone
// home-screen apps) the phrase is recorded, turned into a 16 kHz WAV and written down by Gemini on the server.
import { lang } from './i18n.js';
import { unlockAudio, speakText, stopSpeaking } from './media.js';

const RECOGNITION_LANG = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' };
const MAX_RECORDING_MS = 12000;
const SILENT_START_MS = 8000;
/** The last phrase heard and its language (ru, kk or en): the server detects it from the voice, the browser from the letters. */
export const lastHeard = { text: '', lang: 'ru' };
const lettersLang = (text) => (/[әғқңөұүһі]/i.test(text) ? 'kk' : /[а-яё]/i.test(text) ? 'ru' : /[a-z]/i.test(text) ? 'en' : lang());

// ---------- understanding the phrase ----------
// The time in the phrase («3 часа», «только туда») is read by core/time-words.js.
export { understand } from './time-words.js';

// ---------- listening ----------
export const canListen = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition || (navigator.mediaDevices?.getUserMedia && window.MediaRecorder));

/**
 * Starts listening. Calls onState('listening' | 'thinking' | 'idle'), onText(partial) while words arrive,
 * then resolves with the final phrase ('' when nothing was heard). stop() ends the phrase early.
 */
export function startListening({ onState = () => {}, onText = () => {}, silentStartMs = SILENT_START_MS } = {}) {
  // Called from the tap: this is the moment iOS allows audio, so the spoken answer can play later without another tap.
  unlockAudio();
  let stopper = () => {};
  let cancelled = false;
  const promise = (async () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      const result = await recognize(Recognition, onState, onText, (fn) => { stopper = fn; });
      if (result.ok || cancelled) return heard(result.text, lettersLang(result.text));
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported');
    return record(onState, (fn) => { stopper = fn; }, silentStartMs);
  })().finally(() => onState('idle'));
  return { promise, stop: () => { cancelled = true; stopper(); } };
}

function heard(text, spokenLang) {
  Object.assign(lastHeard, { text: text || '', lang: ['ru', 'kk', 'en'].includes(spokenLang) ? spokenLang : lang() });
  return text || '';
}

/**
 * Hands-free conversation: listen, hand the phrase to onPhrase(text, lang), read its reply aloud, then listen again
 * for a follow-up. Ends when nothing is said, onPhrase returns no reply, again() says no, after maxTurns, or on stop().
 * onState gets 'listening' | 'thinking' | 'speaking' | 'idle'. Call it from a tap.
 */
export function converse({ onState = () => {}, onText = () => {}, onPhrase, again = () => true, followUpMs = 7000, maxTurns = 5 } = {}) {
  let active = true;
  let session = null;
  const inner = (state) => { if (active && state !== 'idle') onState(state); };
  const done = (async () => {
    // A cap on turns keeps street noise from holding a conversation open and spending the free Gemini quota.
    for (let turn = 0; active && turn < maxTurns; turn++) {
      session = startListening({ onState: inner, onText, silentStartMs: turn ? followUpMs : SILENT_START_MS });
      const text = await session.promise;
      if (!active || !text) break;
      onState('thinking');
      const reply = await onPhrase(text, lastHeard.lang);
      if (!active || !reply) break;
      onState('speaking');
      await speakText(reply);
      if (!active || !again()) break;
    }
  })().finally(() => { active = false; onState('idle'); });
  return { done, stop: () => { active = false; session?.stop(); stopSpeaking(); } };
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

async function record(onState, setStop, silentStartMs = SILENT_START_MS) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((item) => MediaRecorder.isTypeSupported?.(item)) || '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  setStop(stop);
  const silence = watchSilence(stream, stop, silentStartMs);
  const limit = setTimeout(stop, MAX_RECORDING_MS);
  recorder.start(250);
  onState('listening');
  await stopped;
  clearTimeout(limit);
  const spoke = silence();
  // Releasing the microphone at once also gives iPhone its loudspeaker back for the spoken answer.
  stream.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
  if (blob.size < 1200 || spoke === false) return heard('', lang());
  onState('thinking');
  const wav = await toWav(blob).catch(() => null);
  const audio = await base64(wav || blob);
  const response = await fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, mimeType: wav ? 'audio/wav' : blob.type, lang: lang() }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'listen_failed');
  return heard(data.text || '', data.lang);
}

// Stops the recording 1.4 s after the person stops talking (once they have said something), or after
// silentStartMs of silence from the start. Returns a cleanup that tells whether any speech was heard (null if unknown).
function watchSilence(stream, stop, silentStartMs = SILENT_START_MS) {
  const context = unlockAudio();
  if (!context) return () => null;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const started = performance.now();
  let spoke = false;
  let quietSince = 0;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    const now = performance.now();
    if (level > 0.035) { spoke = true; quietSince = now; }
    else if (spoke && now - quietSince > 1400) stop();
    else if (!spoke && now - started > silentStartMs) stop();
  }, 100);
  // A context that never ran (locked audio) measured nothing, so it cannot say the phrase was silent.
  return () => { clearInterval(timer); source.disconnect(); return context.state === 'running' ? spoke : null; };
}

// Any recording the browser can decode becomes 16 kHz mono 16-bit WAV, which both Gemini and OpenAI accept.
async function toWav(blob) {
  const context = unlockAudio();
  if (!context) throw new Error('no audio');
  {
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
  }
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
