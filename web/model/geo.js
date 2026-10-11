// Sun position and compass helpers with no three.js dependency, so node tests can import them.
export const PHS = { lat: 40.3587, lon: -74.656 };

/** Where the sun is directly overhead at `date` (NOAA approximation, same as the dashboard globe). */
export function subSolarPoint(date = new Date()) {
  const doy = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  return { lat: decl * 180 / Math.PI, lon: -15 * (hour - 12 + eq / 60) };
}

/** Sun elevation and azimuth (degrees, azimuth clockwise from north) at a place and time. */
export function sunAngles(lat, lon, date = new Date()) {
  const s = subSolarPoint(date), rad = Math.PI / 180;
  const la = lat * rad, dec = s.lat * rad, H = (lon - s.lon) * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.cos(la) * Math.sin(dec) - Math.sin(la) * Math.cos(dec) * Math.cos(H));
  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}

export const COMPASS_WORDS = { N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" };
export function compass(deg) {
  if (deg == null) return null;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((deg % 360) / 45) % 8];
}
