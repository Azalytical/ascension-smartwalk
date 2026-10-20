import { h, icon } from '../core/dom.js';

export function toast(message, { action, onAction, iconName, duration = 3200 } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const node = h('div', { class: 'toast', role: 'status' }, iconName ? icon(iconName) : null, h('span', { text: message }));
  if (action) node.append(h('button', { class: 'toast-action', type: 'button', text: action, onclick: () => { onAction?.(); node.remove(); } }));
  root.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  setTimeout(() => { node.classList.remove('is-in'); setTimeout(() => node.remove(), 300); }, duration);
}

export function announce(message) {
  const live = document.getElementById('announcer');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = message; }, 50);
}
