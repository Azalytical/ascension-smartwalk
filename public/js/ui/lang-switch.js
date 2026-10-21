// The language switch in the page header (РУС · ҚАЗ · ENG). One tap redraws the open screen in the new language
// and keeps the choice on this device (seruen:v1), so /friends, /agent and /watch open in it too.
import { h } from '../core/dom.js';
import { LANGS, lang, setLang, t } from '../core/i18n.js';
import { on } from '../core/store.js';

export function langSwitch() {
  const group = h('div', { class: 'lang-switch', role: 'group' },
    LANGS.map(([id, short, name]) => h('button', { class: 'lang-opt', type: 'button', lang: id, title: name, 'aria-label': name, dataset: { lang: id },
      onclick: () => setLang(id) }, short)));
  const sync = () => {
    group.setAttribute('aria-label', t('me.lang'));
    for (const button of group.children) button.setAttribute('aria-pressed', String(button.dataset.lang === lang()));
  };
  sync();
  on('lang', sync);
  return group;
}
