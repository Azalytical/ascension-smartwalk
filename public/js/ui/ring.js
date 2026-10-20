// The time ring: the walk's minutes as one loop (there, on site, back, reserve). Also used as a live progress ring.
import { svg, h } from '../core/dom.js';

export function timeRing({ there, visit, back, reserve = 5, size = 120, stroke = 12, label, sublabel, progress = null, className = '' }) {
  const total = Math.max(1, there + visit + back + reserve);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 ? Math.min(6, c * 0.012) : 0;
  const parts = [['there', there], ['visit', visit], ['back', back], ['reserve', reserve]].filter(([, v]) => v > 0);
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: `time-ring ${className}`, 'aria-hidden': 'true' });
  const group = svg('g', { transform: `rotate(-90 ${size / 2} ${size / 2})` });
  root.append(group);
  group.append(svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-track', 'stroke-width': stroke, fill: 'none' }));
  let offset = 0;
  for (const [name, value] of parts) {
    const length = Math.max(0, (value / total) * c - gap);
    group.append(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', class: `ring-seg ring-${name}`, 'stroke-width': stroke,
      'stroke-dasharray': `${length} ${c - length}`, 'stroke-dashoffset': -offset, 'stroke-linecap': 'butt' }));
    offset += (value / total) * c;
  }
  if (progress !== null) {
    const p = Math.max(0, Math.min(1, progress));
    const angle = p * 2 * Math.PI;
    group.append(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', class: 'ring-progress', 'stroke-width': stroke,
      'stroke-dasharray': `${p * c} ${c}`, 'stroke-linecap': 'round' }));
    group.append(svg('circle', { cx: size / 2 + r * Math.cos(angle), cy: size / 2 + r * Math.sin(angle), r: stroke * 0.62, class: 'ring-head' }));
  }
  const wrap = h('div', { class: `ring-wrap ${className}`, style: { width: `${size}px`, height: `${size}px` } }, root);
  if (label !== undefined) wrap.append(h('div', { class: 'ring-center' }, h('strong', { class: 'num' }, label), sublabel ? h('span', {}, sublabel) : null));
  return wrap;
}
