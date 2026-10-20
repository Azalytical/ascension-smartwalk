// Gemini media endpoints (docs/integrations.md): «что это за здание?» by photo and the answer read aloud.
import { lang } from './i18n.js';

/** Shrinks a photo to at most 768 px on the long side, as a JPEG data URL (the server's size limit). */
export async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.8);
}

async function post(path, body, timeout = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || String(response.status));
    return data;
  } finally { clearTimeout(timer); }
}

export const identify = ({ image, lat, lon }) => post('/api/vision', { image, lat, lon });

let playing = null;
let audio = null;
/** Call inside a tap: creates and resumes the one audio context, so a spoken answer can play later (iOS needs this). */
export function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audio || audio.state === 'closed') audio = new AudioContext();
  audio.resume?.().catch(() => {});
  try {
    const source = audio.createBufferSource();
    source.buffer = audio.createBuffer(1, 1, 22050);
    source.connect(audio.destination);
    source.start();
  } catch { /* nothing to unlock */ }
  // The browser voice (the fallback) needs the same tap on iOS: an empty phrase unlocks it.
  if ('speechSynthesis' in window && !unlockAudio.voice) { unlockAudio.voice = true; speechSynthesis.speak(new SpeechSynthesisUtterance('')); }
  return audio;
}

// The fallback voice follows the letters of the answer, so a Kazakh answer is read in Kazakh even in the Russian interface.
const voiceLang = (text) => (/[әғқңөұүһі]/i.test(text) ? 'kk-KZ' : /[а-яё]/i.test(text) ? 'ru-RU' : /[a-z]/i.test(text) ? 'en-US' : ({ ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' }[lang()] || 'ru-RU'));

// Bumped by every new phrase and by stop, so a voice that is still loading never starts late over the mic.
let speech = 0;

export function stopSpeaking() {
  speech++;
  playing?.stop();
  playing = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Reads the text with Gemini TTS (24 kHz 16-bit PCM); falls back to the browser voice. Resolves when done. */
export async function speakText(text) {
  stopSpeaking();
  const id = speech;
  const clean = String(text || '').slice(0, 400);
  if (!clean) return;
  const context = audio || unlockAudio();
  try {
    if (!context) throw new Error('no audio');
    const data = await post('/api/speak', { text: clean, lang: lang() }, 30000);
    if (id !== speech) return;
    const bytes = Uint8Array.from(atob(data.data), (char) => char.charCodeAt(0));
    // A WAV answer starts with a RIFF header; the samples after it are the same 16-bit PCM.
    const offset = bytes.length > 44 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' ? 44 : 0;
    const samples = new Int16Array(bytes.buffer, offset, Math.floor((bytes.length - offset) / 2));
    const buffer = context.createBuffer(1, samples.length, data.sampleRate || 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    await context.resume?.();
    // A context that was never unlocked by a tap stays silent on iOS without an error: use the browser voice instead.
    if (context.state !== 'running') throw new Error('audio locked');
    if (id !== speech) return;
    source.start();
    await new Promise((resolve) => {
      playing = { stop: () => { try { source.stop(); } catch { /* already stopped */ } resolve(); } };
      source.onended = resolve;
    });
  } catch {
    if (id !== speech || !('speechSynthesis' in window)) return;
    await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = voiceLang(clean);
      utterance.onend = resolve; utterance.onerror = resolve;
      playing = { stop: () => { speechSynthesis.cancel(); resolve(); } };
      speechSynthesis.speak(utterance);
    });
  } finally {
    if (id === speech) playing = null;
  }
}
