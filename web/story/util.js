// Small helpers shared by the story modules.
import * as THREE from "three";
export { subSolarPoint, sunAngles, compass, COMPASS_WORDS } from "../model/geo.js";

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

export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", " ");
}
