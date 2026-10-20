// Where the person is right now: a fresh high-accuracy fix, never a cached one. The phone keeps improving the fix
// for a few seconds and the most accurate one wins. Shared by the walk tab, «Рядом» and the locate button on the map.
const GOOD_ENOUGH_M = 35;
let last = null;
let pending = null;

/** The last fix this page got: { lat, lon, accuracy, at }, or null. */
export const lastFix = () => last;

/**
 * Resolves with { lat, lon, accuracy, at }. Rejects with an Error whose `reason` is 'denied' (permission off)
 * or 'failed' (no fix in time, no GPS). Calls made while one is running share it.
 */
export function locateMe({ settleMs = 4000, timeoutMs = 15000 } = {}) {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(Object.assign(new Error('unsupported'), { reason: 'failed' })); return; }
    let best = null;
    let settle = null;
    let watch = null;
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      clearTimeout(limit); clearTimeout(settle);
      if (best) {
        last = best;
        document.dispatchEvent(new CustomEvent('seruen:located', { detail: best }));
        resolve(best);
      } else reject(error || Object.assign(new Error('timeout'), { reason: 'failed' }));
    };
    const limit = setTimeout(() => finish(), timeoutMs);
    watch = navigator.geolocation.watchPosition((position) => {
      const { latitude: lat, longitude: lon, accuracy } = position.coords;
      if (!best || accuracy <= best.accuracy) best = { lat, lon, accuracy: Math.round(accuracy), at: Date.now() };
      if (accuracy <= GOOD_ENOUGH_M) finish();
      else settle ||= setTimeout(() => finish(), settleMs);
    }, (failure) => {
      // "Unavailable" and "timeout" can still be followed by a fix (iPhone indoors), so only a refusal ends it early.
      if (failure.code === 1) finish(Object.assign(new Error('denied'), { reason: 'denied' }));
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });
  }).finally(() => { pending = null; });
  return pending;
}
