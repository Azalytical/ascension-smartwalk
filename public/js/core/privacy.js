// The person's own point leaves the phone only rounded to three decimals: a cell of about 110 × 70 m in Astana
// (the same rule as the server, src/privacy.mjs). The exact fix stays on this device for «Вы здесь», the reach ring,
// the drawn route and the map links the person taps. Landmarks picked from the list are public and go as they are.
export const coarse = (value) => Math.round(Number(value) * 1000) / 1000;

/** A GPS fix or a point picked on the map (or from a shared link) belongs to the person; a preset or a place does not. */
export const personal = (point) => point?.kind === 'gps' || point?.kind === 'map';

/** The point as it may be sent anywhere: rounded when it is the person's own. */
export const outbound = (point) => (personal(point) ? { lat: coarse(point.lat), lon: coarse(point.lon) } : { lat: point.lat, lon: point.lon });
