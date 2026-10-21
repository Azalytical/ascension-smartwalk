// Finding Chrome or Edge on Windows and macOS, the show's own browser profile, and placing the two windows:
// the show full screen on the projector, the prompter on the laptop's own screen.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execFileSync } from 'node:child_process';

const WIN = platform() === 'win32';
const MAC = platform() === 'darwin';

export function findBrowser(wanted) {
  if (wanted && existsSync(wanted)) return { path: wanted, name: 'указанный браузер' };
  const env = process.env;
  const list = [];
  if (WIN) {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(Boolean);
    const chrome = roots.map((r) => ({ path: join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome', kind: 'chrome' }));
    const edge = roots.map((r) => ({ path: join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Microsoft Edge', kind: 'edge' }));
    list.push(...(wanted === 'edge' ? [...edge, ...chrome] : [...chrome, ...edge]));
  } else if (MAC) {
    const apps = ['/Applications', join(homedir(), 'Applications')];
    const chrome = apps.map((a) => ({ path: join(a, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'), name: 'Google Chrome', kind: 'chrome' }));
    const edge = apps.map((a) => ({ path: join(a, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'), name: 'Microsoft Edge', kind: 'edge' }));
    const other = apps.flatMap((a) => [{ path: join(a, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), name: 'Chromium' },
      { path: join(a, 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'), name: 'Brave' }]);
    list.push(...(wanted === 'edge' ? [...edge, ...chrome] : [...chrome, ...edge]), ...other);
  } else {
    list.push(...['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
      .map((path) => ({ path, name: 'Chrome' })));
  }
  if (env.AIDEM_CHROME) list.unshift({ path: env.AIDEM_CHROME, name: 'Chromium' });
  return list.find((item) => existsSync(item.path)) || null;
}

// A separate profile just for the show: no extensions, no saved tabs, the site's cache warm from the rehearsal.
export function profileDir() {
  const base = WIN ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'aidem-pitch')
    : MAC ? join(homedir(), 'Library', 'Application Support', 'aidem-pitch') : join(homedir(), '.cache', 'aidem-pitch');
  const dir = join(base, 'profile');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// A show window left open from the last run holds the profile; it is closed first. Only processes whose command line
// names this exact profile folder are touched: the person's usual Chrome and Edge stay as they are.
export function closeOldShow(dir) {
  try {
    if (WIN) {
      const pattern = dir.replace(/'/g, "''");
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${pattern}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { stdio: 'ignore', timeout: 15000 });
    } else {
      execFileSync('pkill', ['-f', `--user-data-dir=${dir}`], { stdio: 'ignore', timeout: 5000 });
    }
  } catch { /* nothing was running */ }
}

// Screens as the prompter page sees them (Window Management API), with the show's choice of projector and laptop.
export function pickScreens(screens) {
  if (!Array.isArray(screens) || !screens.length) return { count: 0, projector: null, laptop: null };
  if (screens.length === 1) return { count: 1, projector: screens[0], laptop: screens[0] };
  // The laptop's own panel is «internal»; the projector is the other one. On two external monitors: the primary is the presenter's.
  const laptop = screens.find((s) => s.isInternal) || screens.find((s) => s.isPrimary) || screens[0];
  const others = screens.filter((s) => s !== laptop);
  const projector = others.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return { count: screens.length, projector, laptop };
}

export async function windowOf(cdp) {
  const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
  return { windowId, bounds };
}

// Moves a window onto a screen and makes it full screen (or maximized). The bounds are set first, so the window
// covers the screen even where the full-screen state is refused.
export async function place(cdp, screen, state = 'fullscreen') {
  const { windowId, bounds } = await windowOf(cdp);
  if (bounds.windowState !== 'normal') await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
  const area = state === 'fullscreen' ? { left: screen.left, top: screen.top, width: screen.width, height: screen.height }
    : { left: screen.availLeft ?? screen.left, top: screen.availTop ?? screen.top, width: screen.availWidth ?? screen.width, height: screen.availHeight ?? screen.height };
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: area }).catch(() => {});
  if (state !== 'normal') await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: state } }).catch(() => {});
  return windowOf(cdp);
}
