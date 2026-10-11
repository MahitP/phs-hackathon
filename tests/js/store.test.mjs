// shell/store.js: the one place the page gets data from (the Pi, or Open-Meteo through LocalSky).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../web/shell/store.js";

const PI_STATE = { verdict: { key: "open" }, sky: { us_aqi: 31, pm2_5: 6.5, aod: 0.09, wind_speed: 12, wind_dir: 225, temperature: 18 },
  indoor: { stale_index: 22 }, clarity: { sun_elevation: 30, haze_transmission: 88 }, mock: false };

/** Fake clock + timers: run() advances time and fires due callbacks in order. */
function fakeTime() {
  let t = 1_000_000, id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimeout: (i) => timers.delete(i),
    pending: () => [...timers.values()].map((x) => x.at - t).sort((a, b) => a - b),
    async run(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn();
        await flush();
      }
      t = end;
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));

function fakeDoc() {
  const fns = [];
  return { hidden: false, addEventListener: (ev, fn) => ev === "visibilitychange" && fns.push(fn), fire() { fns.forEach((f) => f()); } };
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function setup({ pi = "ok", local = "ok", storage = memStorage() } = {}) {
  const time = fakeTime(), doc = fakeDoc(), calls = { pi: 0, local: 0 };
  const fetchFn = async (url) => {
    assert.equal(url, "api/now");
    calls.pi++;
    if (typeof pi === "function") return pi(calls.pi);
    if (pi === "down") throw new TypeError("network");
    if (pi === "warming") return { ok: false, status: 503, json: async () => ({}) };
    if (pi === "missing") return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => PI_STATE };
  };
  const localSky = { state: async () => { calls.local++; if (typeof local === "function") return local(calls.local); if (local === "down") throw new Error("offline"); return { ...PI_STATE, mock: true, showcase: true, verdict: { key: "either" } }; } };
  const store = createStore({ fetch: fetchFn, localSky, storage, document: doc, now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout });
  return { store, time, doc, calls, storage };
}

test("a Pi that answers is the source, polled every 2 s in the live window", async () => {
  const { store, time, calls } = setup();
  const seen = [];
  store.subscribe((s) => seen.push(s.status));
  store.start("live");
  await flush(); await flush();
  const s = store.get();
  assert.equal(s.status, "ok");
  assert.equal(s.source, "pi");
  assert.equal(s.live.aqi, 31);
  assert.equal(s.live.verdict, "open");
  assert.deepEqual(time.pending(), [2000]);
  await time.run(2000);
  assert.equal(calls.pi, 2);
  assert.ok(seen.includes("ok"));
});

test("the story polls the Pi only every 30 s", async () => {
  const { store, time } = setup();
  store.start("story");
  await flush(); await flush();
  assert.deepEqual(time.pending(), [30000]);
  store.setMode("live");
  assert.deepEqual(time.pending(), [2000]);
});

test("without a Pi the page falls back to the showcase sky, every 5 s", async () => {
  const { store, time, calls } = setup({ pi: "missing" });
  store.start("live");
  await flush(); await flush(); await flush();
  const s = store.get();
  assert.equal(s.source, "showcase");
  assert.equal(s.live.mode, "showcase");
  assert.equal(s.live.verdict, "either");
  assert.deepEqual(time.pending(), [5000]);
  await time.run(5000);
  assert.equal(calls.pi, 1, "the Pi is detected once, not asked again");
  assert.equal(calls.local, 2);
});

test("a Pi that has no sky data yet is still the source, never the showcase", async () => {
  const noSky = { ...PI_STATE, sky: null };
  const { store, time, calls } = setup({ pi: () => ({ ok: true, status: 200, json: async () => noSky }) });
  store.start("live");
  await flush(); await flush();
  assert.equal(store.get().source, "pi");
  assert.equal(store.get().status, "ok");
  assert.equal(store.get().live.verdict, "open");
  assert.equal(store.get().live.aqi, undefined);
  await time.run(2000);
  assert.equal(calls.local, 0, "Open-Meteo is never asked while a Pi answers");
});

test("a Pi still warming up says so", async () => {
  const { store } = setup({ pi: "warming" });
  store.start("live");
  await flush(); await flush();
  assert.equal(store.get().status, "warming");
  assert.equal(store.get().source, "pi");
});

test("failures after a good reading mark it stale and back off 2, 4, 8, 15 s", async () => {
  const { store, time } = setup({ pi: (n) => { if (n === 1) return { ok: true, status: 200, json: async () => PI_STATE }; throw new TypeError("network"); } });
  store.start("live");
  await flush(); await flush();
  assert.equal(store.get().status, "ok");
  const gaps = [];
  for (let i = 0; i < 5; i++) { gaps.push(time.pending()[0]); await time.run(time.pending()[0]); }
  assert.deepEqual(gaps, [2000, 2000, 4000, 8000, 15000]);
  assert.equal(store.get().status, "stale");
  assert.equal(store.get().live.aqi, 31, "the last good reading is kept");
});

test("a hidden tab stops polling and polls at once when visible again", async () => {
  const { store, time, doc, calls } = setup();
  store.start("live");
  await flush(); await flush();
  doc.hidden = true; doc.fire();
  assert.deepEqual(time.pending(), []);
  doc.hidden = false; doc.fire();
  await flush(); await flush();
  assert.equal(calls.pi, 2);
});

test("only one request is in flight at a time", async () => {
  let release;
  const { store, calls } = setup({ pi: () => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => PI_STATE }); }) });
  store.start("live");
  await flush();
  store.refresh(); store.refresh();
  assert.equal(calls.pi, 1);
  release(); await flush(); await flush();
  assert.equal(store.get().status, "ok");
});

test("with nothing reachable, the last saved reading is shown as offline", async () => {
  const first = setup();
  first.store.start("live");
  await flush(); await flush();
  const saved = first.storage;
  const { store } = setup({ pi: "down", local: "down", storage: saved });
  store.start("live");
  for (let i = 0; i < 4; i++) await flush();
  const s = store.get();
  assert.equal(s.status, "offline");
  assert.equal(s.live.mode, "cached");
  assert.equal(s.live.aqi, 31);
});

test("with nothing reachable and nothing saved, the status is error", async () => {
  const { store } = setup({ pi: "down", local: "down" });
  store.start("live");
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(store.get().status, "error");
  assert.equal(store.get().live, null);
});
