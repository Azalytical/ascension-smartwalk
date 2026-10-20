// PWA install prompt (Chrome/Android/desktop) and the iOS "Add to Home Screen" hint.
let deferred = null;
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event; });
window.addEventListener('appinstalled', () => { deferred = null; });

export function installState() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'installed';
  if (deferred) return 'available';
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return 'ios';
  return 'manual';
}

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const choice = await deferred.userChoice.catch(() => null);
  deferred = null;
  return choice?.outcome === 'accepted';
}
