// The one data source for the story and the live window.
// The Pi's /api/now in device mode, otherwise Open-Meteo straight from the browser through
// sky-local.js (showcase mode). Which one is decided once. The last good reading is cached, so a
// dropped network at judging still shows real numbers, labelled with their age.
//
// status: boot (nothing yet) | ok | warming (the Pi is starting) | stale (polls failing, reading kept)
//       | offline (only a saved reading from earlier) | error (nothing at all)
import { compass, COMPASS_WORDS, sunAngles, PHS } from "../model/geo.js";

const CACHE_KEY = "skywindow-story-live";
const EVERY = { pi: { live: 2000, story: 30000 }, showcase: { live: 5000, story: 30000 } };
const BACKOFF = [2000, 4000, 8000, 15000];
const TIMEOUT = 4000; // the Pi's first reading can take a moment

/** The flat shape both the story and the live window read. */
export function normalize(s, mode, at = Date.now()) {
  const sky = s.sky || {}, v = s.verdict || {}, ind = s.indoor || {}, cl = s.clarity || {};
  const dir = compass(sky.wind_dir);
  const sun = sunAngles(PHS.lat, PHS.lon, new Date(at));
  return {
    mode, mock: !!s.mock, at,
    aqi: sky.us_aqi, pm25: sky.pm2_5, aod: sky.aod, wind: sky.wind_speed, windDir: sky.wind_dir,
    windFrom: dir ? COMPASS_WORDS[dir] : null, temp: sky.temperature, cloud: sky.cloud_cover,
    precip: sky.precipitation, weatherCode: sky.weather_code, humidity: sky.humidity,
    isDay: sky.is_day, stale: ind.stale_index, verdict: v.key || "either", reasons: v.reasons || [],
    outdoorLevel: v.outdoor_level, air: ind.air, baseline: ind.baseline, rate: ind.rate_per_min,
    sunElevation: cl.sun_elevation ?? sun.elevation, sunAzimuth: sun.azimuth,
    transmission: cl.haze_transmission, replay: s.replay || null, fires: s.fires || null,
    forecast: sky.forecast || null,
  };
}

export function createStore({
  fetch = globalThis.fetch?.bind(globalThis), localSky = null, storage = globalThis.localStorage, document = globalThis.document,
  now = () => Date.now(), setTimeout = globalThis.setTimeout.bind(globalThis), clearTimeout = globalThis.clearTimeout.bind(globalThis),
} = {}) {
  let mode = "story", source = null, status = "boot", raw = null, live = null, lastGood = 0;
  let timer = null, inFlight = null, fails = 0, started = false;
  const subs = new Set();

  const snapshot = () => ({ status, source, live, raw, at: lastGood, age: lastGood ? now() - lastGood : null });
  const emit = () => { const s = snapshot(); subs.forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } }); };

  function save(l) { try { storage?.setItem(CACHE_KEY, JSON.stringify(l)); } catch { /* private mode */ } }
  function saved() { try { return JSON.parse(storage?.getItem(CACHE_KEY) || "null"); } catch { return null; } }

  async function fromPi() {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort(), TIMEOUT);
    try {
      const r = await fetch("api/now", { cache: "no-store", signal: ctrl?.signal });
      if (r.status === 503) return { warming: true };
      if (!r.ok) return null;
      const s = await r.json();
      return s && s.sky ? { state: s } : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  async function fromShowcase() {
    if (!localSky) return null;
    try { const s = await localSky.state(); return s && s.sky ? { state: s } : null; } catch { return null; }
  }

  async function poll() {
    let got = null;
    if (source === null || source === "pi") {
      got = await fromPi();
      if (source === null) source = got ? "pi" : "showcase"; // decided once: 2xx or 503 means a Pi
    }
    if (source === "showcase") got = await fromShowcase();

    if (got?.state) {
      raw = got.state; lastGood = now(); fails = 0;
      live = normalize(raw, source === "pi" ? "device" : "showcase", lastGood);
      if (live.aqi != null) save(live);
      status = "ok";
    } else if (got?.warming) {
      fails = 0;
      if (!live) status = "warming"; // a restarting Pi keeps showing its last reading
    } else {
      fails++;
      if (live && live.mode !== "cached" && now() - lastGood < 10 * 60 * 1000) status = "stale";
      else {
        const c = live || saved();
        if (c) { live = { ...c, mode: "cached" }; lastGood = lastGood || c.at || 0; status = "offline"; }
        else status = "error";
      }
    }
    emit();
  }

  function delay() {
    if (fails > 0) return BACKOFF[Math.min(fails - 1, BACKOFF.length - 1)];
    return EVERY[source === "pi" ? "pi" : "showcase"][mode];
  }

  function schedule() {
    clearTimeout(timer); timer = null;
    if (!started || inFlight || document?.hidden) return;
    timer = setTimeout(() => { timer = null; refresh(); }, delay());
  }

  function refresh() {
    if (inFlight) return inFlight;
    clearTimeout(timer); timer = null;
    inFlight = poll().catch((e) => console.error(e)).finally(() => { inFlight = null; schedule(); });
    return inFlight;
  }

  document?.addEventListener?.("visibilitychange", () => {
    if (!started) return;
    if (document.hidden) { clearTimeout(timer); timer = null; } else refresh();
  });

  return {
    start(m = mode) { mode = m; if (started) return; started = true; refresh(); },
    setMode(m) { if (m === mode) return; mode = m; if (!inFlight) schedule(); },
    refresh, get: snapshot,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    get mode() { return mode; },
  };
}
