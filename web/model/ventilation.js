// What opening the sash would do: an estimate, and labelled as one wherever it is shown.
// Airflow through one single-sided opening (CIBSE AM10, Natural ventilation in non-domestic buildings):
//   wind-driven   Qw = 0.025 A U
//   stack-driven  Qs = Cd (A / 3) sqrt(g h |dT| / T)
//   combined      Q  = sqrt(Qw^2 + Qs^2)
// A = opening area (m^2), U = wind speed (m/s), h = height of the opening (m), T = mean absolute temperature.
// The room's air then relaxes toward a steady state: a well-mixed box with occupancy as the source.

export const ROOM_VOLUME = 9 * 8.45 * 3; // the classroom in the 3D scene (story/models/sash.js ROOM), m^3
export const SASH_WIDTH = 1.05; // clear width of the lower sash opening, m
export const ROOM_TEMP_C = 21; // assumed: the Pi has no thermometer, and the UI says so
const CD = 0.6, G = 9.81;
export const INFILTRATION = 0.3; // air changes per hour through a shut window and the door
export const SOURCE = 18; // stale-index points per hour that a full class adds (a shut room heads toward 60)
export const FRESH = 25; // below this the room counts as fresh (server/decide.py "both sides are clean")
const PENETRATION = 0.9, DEPOSITION = 0.2; // outdoor PM2.5 that gets in; how fast it settles indoors (per hour)

/** Air through the open sash. raise in metres (0..0.78), wind in km/h, outdoor temperature in degrees C. */
export function airflow({ raise, windKmh = 0, tOutC = ROOM_TEMP_C, tInC = ROOM_TEMP_C }) {
  const r = Math.max(0, raise || 0);
  const area = SASH_WIDTH * r;
  const u = Math.max(0, windKmh || 0) / 3.6;
  const qWind = 0.025 * area * u;
  const dT = Math.abs((tInC ?? ROOM_TEMP_C) - (tOutC ?? ROOM_TEMP_C));
  const tMean = ((tInC ?? ROOM_TEMP_C) + (tOutC ?? ROOM_TEMP_C)) / 2 + 273.15;
  const qStack = CD * (area / 3) * Math.sqrt(G * r * dT / tMean);
  const q = Math.hypot(qWind, qStack);
  return { area, qWind, qStack, q, ach: (3600 * q) / ROOM_VOLUME };
}

const lambda = (ach) => INFILTRATION + Math.max(0, ach || 0);

/** Stale index after `minutes` with `ach` extra air changes per hour from the window. */
export function projectIndex({ idx0, ach, minutes }) {
  const l = lambda(ach), ss = SOURCE / l;
  return Math.max(0, ss + (idx0 - ss) * Math.exp(-l * minutes / 60));
}

/** Minutes until the room is fresh (index under 25): 0 if it already is, null if it never gets there. */
export function minutesToFresh({ idx0, ach }) {
  if (idx0 < FRESH) return 0;
  const l = lambda(ach), ss = SOURCE / l;
  if (ss >= FRESH) return null;
  return (-Math.log((FRESH - ss) / (idx0 - ss)) / l) * 60;
}

/** Indoor PM2.5 (ug/m3) after `minutes`, starting from the shut-window steady state. */
export function indoorPM({ cOut, ach, minutes }) {
  const ss = (l) => (PENETRATION * l * cOut) / (l + DEPOSITION);
  const l = lambda(ach), c0 = ss(INFILTRATION), c1 = ss(l);
  return c1 + (c0 - c1) * Math.exp(-(l + DEPOSITION) * minutes / 60);
}
