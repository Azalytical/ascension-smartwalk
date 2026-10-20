// A person's point is worked with only as a cell of about 110 × 70 m in Astana: latitude and longitude to three decimals.
// The site and the watch round before sending. The server rounds again wherever a point can still arrive exact
// (Siri, Telegram, the agent, the photo search), so nothing Gemini sees is computed from more than that cell.
export const COARSE_DECIMALS = 3;

/** One coordinate to three decimals; NaN stays NaN, so the usual bounds checks still reject a missing value. */
export const coarse = value => Math.round(Number(value) * 1000) / 1000;

export const coarsePoint = point => ({ lat: coarse(point?.lat), lon: coarse(point?.lon) });
