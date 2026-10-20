import * as store from './store.js';
import { emit } from './store.js';

export const isDark = () => {
  const choice = store.get('theme') || 'auto';
  return choice === 'dark' || (choice === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
};

export function applyTheme() {
  const choice = store.get('theme') || 'auto';
  if (choice === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = choice;
  const dark = isDark();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', dark ? '#0B0B0D' : '#F4F3EF'));
  emit('theme', dark);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
