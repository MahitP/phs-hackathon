// Live readings for the story: the Pi's /api/now in device mode, otherwise Open-Meteo straight from
// the browser through sky-local.js (showcase mode). The last good reading is cached so the story can
// still show real numbers, labelled with their time, if the network drops at judging.
import { compass, COMPASS_WORDS, sunAngles } from "./util.js";

const CACHE_KEY = "skywindow-story-live";
const LAT = 40.3587, LON = -74.656;

function normalize(s, mode) {
  const sky = s.sky || {}, v = s.verdict || {}, ind = s.indoor || {}, cl = s.clarity || {};
  const dir = compass(sky.wind_dir);
  const sun = sunAngles(LAT, LON, new Date());
  return {
    mode, mock: !!s.mock, at: Date.now(),
    aqi: sky.us_aqi, pm25: sky.pm2_5, aod: sky.aod, wind: sky.wind_speed, windDir: sky.wind_dir,
    windFrom: dir ? COMPASS_WORDS[dir] : null, temp: sky.temperature, cloud: sky.cloud_cover,
    isDay: sky.is_day, stale: ind.stale_index, verdict: v.key || "either",
    sunElevation: cl.sun_elevation ?? sun.elevation, sunAzimuth: sun.azimuth,
    transmission: cl.haze_transmission,
  };
}

async function fromDevice() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000); // the Pi's first reading can take a moment
  try {
    const r = await fetch("api/now", { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) return null;
    const s = await r.json();
    return s && s.sky ? normalize(s, "device") : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

// sky-local.js declares `const LocalSky` at the top level of a classic script: it's a global binding
// but not a property of window, so read it by name.
const localSky = () => (typeof LocalSky !== "undefined" ? LocalSky : null); // eslint-disable-line no-undef

export async function getLive() {
  let live = await fromDevice();
  if (!live && localSky()) {
    try { live = normalize(await localSky().state(), "showcase"); } catch { live = null; }
  }
  if (live && live.aqi != null) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch {}
    return live;
  }
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached) return { ...cached, mode: "cached" };
  } catch {}
  return null;
}
