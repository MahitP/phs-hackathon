// Small helpers shared by the story modules.
import * as THREE from "three";

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
/** 0 before a, 1 after b, linear between. */
export const range = (t, a, b) => clamp((t - a) / (b - a));
/** Fades in over a..b and out over c..d. */
export const band = (t, a, b, c, d) => range(t, a, b) * (1 - range(t, c, d));
/** Exponential smoothing that behaves the same at any frame rate. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Same mapping as three's SphereGeometry UVs, so it lines up with equirectangular Earth textures. */
export function latLon(lat, lon, r = 1, v = new THREE.Vector3()) {
  const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
  return v.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

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

/** Direction toward the sun in a local frame where x = east, y = up, z = south. */
export function sunVector(elevation, azimuth, v = new THREE.Vector3()) {
  const e = elevation * Math.PI / 180, a = azimuth * Math.PI / 180;
  return v.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

export function canvasTexture(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft round sprite used for stars, smoke puffs and glows. */
export function glowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  return canvasTexture(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, inner); r.addColorStop(0.25, inner.replace(/[\d.]+\)$/, "0.55)")); r.addColorStop(1, outer);
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
}

export const COMPASS_WORDS = { N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" };
export function compass(deg) {
  if (deg == null) return null;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((deg % 360) / 45) % 8];
}

export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", " ");
}
