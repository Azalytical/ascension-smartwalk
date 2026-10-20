// Walk-specific map layers: start point, reach ring, numbered result pins and route lines.
import { h } from '../core/dom.js';
import { circlePolygon } from '../core/geo.js';
import { walkingRoute } from '../core/api.js';
import { setOverlay, removeOverlay, setData, marker, cssVar, fitPoints, getMap } from './map.js';

let startMarker = null;
let pins = [];
const empty = { type: 'FeatureCollection', features: [] };

export function showStart(start, label, { tag = false } = {}) {
  startMarker?.remove();
  // A GPS start is the person: the blue dot (with «Вы здесь» on the plan map, where no pins cover it); any other start is the gold pin.
  const el = start.kind === 'gps'
    ? h('div', { class: 'here-pin', title: label, 'aria-hidden': 'true' }, h('span', { class: 'user-dot' }, h('span')), tag ? h('span', { class: 'here-label', text: label }) : null)
    : h('div', { class: 'start-pin', title: label, 'aria-hidden': 'true' }, h('span'));
  startMarker = marker(el, [start.lon, start.lat]);
}
export function hideStart() { startMarker?.remove(); startMarker = null; }

export function showReach(start, meters) {
  const data = meters > 0 ? circlePolygon(start.lon, start.lat, meters) : empty;
  setOverlay('reach', {
    sources: { reach: { type: 'geojson', data } },
    layers: [
      { id: 'reach-fill', type: 'fill', source: 'reach', paint: { 'fill-color': () => cssVar('--gold'), 'fill-opacity': 0.12 } },
      { id: 'reach-line', type: 'line', source: 'reach', paint: { 'line-color': () => cssVar('--gold-strong'), 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } },
    ],
  });
}
export function updateReach(start, meters) { setData('reach', meters > 0 ? circlePolygon(start.lon, start.lat, meters) : empty); }
export function hideReach() { removeOverlay('reach'); }

function routeFeatures(routes) {
  return { type: 'FeatureCollection', features: routes.map((route) => ({ type: 'Feature', properties: { selected: route.selected ? 1 : 0, real: route.real ? 1 : 0 }, geometry: { type: 'LineString', coordinates: route.coordinates } })) };
}
let currentRoutes = [];
export function showRoutes(routes) {
  currentRoutes = routes;
  setOverlay('routes', {
    sources: { routes: { type: 'geojson', data: routeFeatures(routes) } },
    layers: [
      { id: 'routes-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'selected'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': () => cssVar('--surface'), 'line-width': 9, 'line-opacity': 0.9 } },
      { id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': () => cssVar('--sky'), 'line-width': ['case', ['==', ['get', 'selected'], 1], 5, 2.5], 'line-opacity': ['case', ['==', ['get', 'selected'], 1], 1, 0.55],
          'line-dasharray': ['case', ['==', ['get', 'real'], 1], ['literal', [1, 0]], ['literal', [1.5, 1.6]]] } },
    ],
  });
}
export function hideRoutes() { currentRoutes = []; removeOverlay('routes'); }

/** Swap a straight line for the real walking route when the routing service answers. */
export async function upgradeRoute(index, from, to) {
  const route = await walkingRoute(from, to);
  if (!route || !currentRoutes[index]) return null;
  currentRoutes[index] = { ...currentRoutes[index], coordinates: route.coordinates, real: true };
  setData('routes', routeFeatures(currentRoutes));
  return route;
}

export function selectRoute(index) {
  currentRoutes = currentRoutes.map((route, i) => ({ ...route, selected: i === index }));
  setData('routes', routeFeatures(currentRoutes));
}

export function showPins(places, onSelect) {
  hidePins();
  pins = places.map((place, index) => {
    const el = h('button', { class: 'result-pin', type: 'button', 'aria-label': `${index + 1}. ${place.name}`, onclick: (event) => { event.stopPropagation(); onSelect(index); } }, h('span', { text: index + 1 }));
    return marker(el, [place.lon, place.lat], { anchor: 'bottom' });
  });
}
export function selectPin(index) {
  pins.forEach((pin, i) => pin?.getElement().classList.toggle('is-selected', i === index));
}
export function hidePins() { pins.forEach((pin) => pin?.remove()); pins = []; }

export function frame(start, places) {
  fitPoints([[start.lon, start.lat], ...places.map((place) => [place.lon, place.lat])], { maxZoom: 16.5 });
}

export function clearWalkLayers() { hidePins(); hideRoutes(); hideReach(); }
export const mapAvailable = () => Boolean(getMap());
