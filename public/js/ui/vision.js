// «Что это за здание?»: one hidden camera input shared by the map button and the «Рядом» tab.
// The photo is shrunk to 768 px and handed to the «Рядом» tab, which asks Gemini (POST /api/vision).
import { h } from '../core/dom.js';
import { openTab } from '../shell.js';
import { toast } from './toast.js';
import { t } from '../core/i18n.js';

let picker = null;

export function askPhoto() {
  if (!picker) {
    picker = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      picker.value = '';
      if (!file) return;
      try {
        const { shrinkPhoto } = await import('../core/media.js');
        openTab('explore', { vision: await shrinkPhoto(file) });
      } catch { toast(t('vision.fail'), { iconName: 'warning' }); }
    });
    document.body.append(picker);
  }
  picker.click();
}
