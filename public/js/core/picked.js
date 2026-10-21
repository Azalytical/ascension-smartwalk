// The place last picked on the map: a dot opened in «Рядом», a walk result tapped or opened.
// «Позвать в место» on the «Друзья» tab starts from it, so the person does not look for it twice.
// Kept in memory for this page only: it is a convenience, not a preference.
const FRESH_MS = 30 * 60_000;
let picked = null;

export function pickPlace(place) {
  picked = place && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon))
    ? { id: place.id ?? null, name: place.name, category: place.category ?? null, lat: Number(place.lat), lon: Number(place.lon), at: Date.now() }
    : null;
}

/** The picked place if it is from the last half hour, else null. */
export function pickedPlace() {
  return picked && Date.now() - picked.at < FRESH_MS ? picked : null;
}
