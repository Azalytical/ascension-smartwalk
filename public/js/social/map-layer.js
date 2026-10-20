// Friends, meetups, events and meeting-point options on the shared MapLibre map.
// Everything this module adds is prefixed with "friends-" and removed by destroy().
import { t } from '../core/i18n.js';
import './strings.js';

const STALE_MS = 10 * 60_000;
const CATEGORY_EMOJI = { walk: '🚶', sport: '🏃', food: '🍽', culture: '🎭', study: '📚', kids: '🧸', other: '✨' };
const EMPTY = { type: 'FeatureCollection', features: [] };

function circlePolygon(lat, lon, meters, steps = 40) {
  const coordinates = [];
  const dLat = meters / 110540, dLon = meters / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    coordinates.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } };
}

function avatarElement(person, { stale = false, label = person.name, badge = '' } = {}) {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = `sx-map-avatar${stale ? ' is-stale' : ''}`;
  root.style.setProperty('--avatar', person.color || '#1A8CFF');
  root.setAttribute('aria-label', label);
  const face = document.createElement('span');
  face.className = 'sx-map-avatar-face';
  face.textContent = person.emoji || '🙂';
  const name = document.createElement('span');
  name.className = 'sx-map-avatar-name';
  name.textContent = badge ? `${person.name} · ${badge}` : person.name;
  root.append(face, name);
  return root;
}

function pinElement(className, glyph, label) {
  // MapLibre positions markers with a transform on the root, so the pin shape is rotated inside it.
  const root = document.createElement('button');
  root.type = 'button';
  root.className = className;
  root.setAttribute('aria-label', label);
  const shape = document.createElement('span');
  shape.className = 'sx-map-pin-shape';
  const face = document.createElement('span');
  face.textContent = glyph;
  shape.append(face);
  root.append(shape);
  return root;
}

export function createSocialLayer(map, maplibregl, { onFriend, onMeetup, onEvent, onOption } = {}) {
  const Marker = maplibregl?.Marker;
  const markers = new Map();
  let accuracy = EMPTY, lines = EMPTY;
  let destroyed = false;

  function ensureSources() {
    if (destroyed) return false;
    try {
      addSources();
      return true;
    } catch {
      // The style is still loading: try again once the map settles.
      map.once?.('idle', onStyle);
      return false;
    }
  }
  function addSources() {
    if (!map.getSource('friends-accuracy')) {
      map.addSource('friends-accuracy', { type: 'geojson', data: accuracy });
      map.addLayer({ id: 'friends-accuracy-fill', type: 'fill', source: 'friends-accuracy', paint: { 'fill-color': '#1A8CFF', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'friends-accuracy-line', type: 'line', source: 'friends-accuracy', paint: { 'line-color': '#1A8CFF', 'line-opacity': 0.45, 'line-width': 1 } });
    }
    if (!map.getSource('friends-lines')) {
      map.addSource('friends-lines', { type: 'geojson', data: lines });
      map.addLayer({ id: 'friends-lines', type: 'line', source: 'friends-lines', layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#1A8CFF'], 'line-width': 3, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.85 } });
    }
  }
  const onStyle = () => { if (ensureSources()) { map.getSource('friends-accuracy')?.setData(accuracy); map.getSource('friends-lines')?.setData(lines); } };
  map.on?.('styledata', onStyle);
  map.on?.('load', onStyle);

  function place(key, element, lngLat, onClick) {
    if (!Marker) return;
    const existing = markers.get(key);
    if (existing && existing.html === element.outerHTML) { existing.marker.setLngLat(lngLat); return; }
    existing?.marker.remove();
    if (onClick) element.addEventListener('click', event => { event.stopPropagation(); onClick(); });
    const marker = new Marker({ element, anchor: 'bottom' }).setLngLat(lngLat).addTo(map);
    markers.set(key, { marker, html: element.outerHTML, seen: true });
  }

  function sweep(prefix, keep) {
    for (const [key, entry] of markers) {
      if (key.startsWith(prefix) && !keep.has(key)) { entry.marker.remove(); markers.delete(key); }
    }
  }

  function setAccuracy(collection) {
    accuracy = collection;
    if (ensureSources()) map.getSource('friends-accuracy').setData(accuracy);
  }

  function setLines(collection) {
    lines = collection;
    if (ensureSources()) map.getSource('friends-lines').setData(lines);
  }

  return {
    /** friends: state.friends; meetups: state.meetups; events: events to show (empty to hide). */
    update({ me = null, friends = [], meetups = [], events = [], badges = {} }) {
      const keep = new Set();
      const circles = [];
      const now = Date.now();
      if (me && Number.isFinite(me.lat)) {
        keep.add('friend:me');
        place('friend:me', avatarElement({ ...me, name: t('sx.you') }, { label: t('sx.you') }), [me.lon, me.lat]);
      }
      for (const friend of friends) {
        const location = friend.location;
        if (!location || location.lat === undefined) continue;
        const key = `friend:${friend.id}`;
        keep.add(key);
        const stale = location.updatedAt && now - location.updatedAt > STALE_MS;
        place(key, avatarElement(friend, { stale, badge: badges[friend.id] || '' }), [location.lon, location.lat], () => onFriend?.(friend.id));
        if (location.accuracy && location.accuracy >= 60) circles.push(circlePolygon(location.lat, location.lon, Math.min(location.accuracy, 1500)));
      }
      sweep('friend:', keep);
      setAccuracy({ type: 'FeatureCollection', features: circles });

      const meetupKeys = new Set();
      for (const meetup of meetups) {
        if (meetup.status !== 'active') continue;
        const key = `meetup:${meetup.id}`;
        meetupKeys.add(key);
        place(key, pinElement('sx-map-pin is-meetup', '🤝', t('sx.map.meetup', { title: meetup.title, place: meetup.place.name })), [meetup.place.lon, meetup.place.lat], () => onMeetup?.(meetup.id));
      }
      sweep('meetup:', meetupKeys);

      const eventKeys = new Set();
      for (const event of events) {
        if (event.status !== 'active') continue;
        const key = `event:${event.id}`;
        eventKeys.add(key);
        place(key, pinElement('sx-map-pin is-event', CATEGORY_EMOJI[event.category] || '✨', t('sx.map.event', { title: event.title })), [event.place.lon, event.place.lat], () => onEvent?.(event.id));
      }
      sweep('event:', eventKeys);
    },

    /** Numbered meeting-point options and dashed lines from each person to the highlighted one. */
    showMeeting(result, people, selected = 0) {
      const keep = new Set();
      result.options.forEach((option, index) => {
        const key = `option:${index}:${option.place.id}`;
        keep.add(key);
        const element = pinElement(`sx-map-pin is-option${index === selected ? ' is-selected' : ''}`, String(index + 1), t('sx.map.option', { n: index + 1, place: option.place.name }));
        if (index === selected) element.style.zIndex = '3';
        place(key, element, [option.place.lon, option.place.lat], () => onOption?.(index));
      });
      sweep('option:', keep);
      const target = result.options[selected];
      setLines({ type: 'FeatureCollection', features: target ? people.filter(person => Number.isFinite(person.lat)).map(person => ({
        type: 'Feature', properties: { color: person.color }, geometry: { type: 'LineString', coordinates: [[person.lon, person.lat], [target.place.lon, target.place.lat]] }
      })) : [] });
    },

    clearMeeting() { sweep('option:', new Set()); setLines(EMPTY); },

    fit(points, padding = 80) {
      const valid = points.filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
      if (!valid.length || !map.fitBounds) return;
      if (valid.length === 1) { map.flyTo?.({ center: [valid[0].lon, valid[0].lat], zoom: Math.max(map.getZoom?.() ?? 14, 15) }); return; }
      const lons = valid.map(point => point.lon), lats = valid.map(point => point.lat);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding, maxZoom: 16, duration: 700 });
    },

    destroy() {
      destroyed = true;
      for (const entry of markers.values()) entry.marker.remove();
      markers.clear();
      map.off?.('styledata', onStyle);
      map.off?.('load', onStyle);
      for (const id of ['friends-accuracy-fill', 'friends-accuracy-line', 'friends-lines']) if (map.getLayer?.(id)) map.removeLayer(id);
      for (const id of ['friends-accuracy', 'friends-lines']) if (map.getSource?.(id)) map.removeSource(id);
    }
  };
}

export { CATEGORY_EMOJI };
