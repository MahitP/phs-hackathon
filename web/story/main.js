// SkyWindow story: boot, loader, warm-up, the render loop and scene hand-offs.
import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { createScroll } from "./scroll.js";
import { createPost } from "./fx.js";
import { createHUD } from "./hud.js";
import { getLive } from "./live.js";
import { Sound } from "./sound.js";
import { createEarth } from "./worlds/earth.js";
import { createPrinceton } from "./worlds/princeton.js";
import { createRoom } from "./worlds/room.js";
import { range, clamp, formatTime } from "./util.js";

const params = new URLSearchParams(location.search);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (id) => document.getElementById(id);
document.documentElement.classList.add("js");

// hero poses the scroll settles onto (story time)
const SNAPS = [0.56, 3.5, 4.78, 6.1, 6.3, 6.5, 6.7, 6.88, 7.15, 7.38, 7.61, 7.86, 8.5];
// hand-offs between the three worlds: [start, end, swap point, cloud colour]
const CURTAINS = [[2.25, 2.95, 2.656, "#8d97a4"], [4.86, 5.36, 5.15, "#e9edf0"]];

function webglOK() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

function pickTier() {
  const forced = params.get("tier");
  if (["low", "mid", "high"].includes(forced)) return forced;
  const coarse = matchMedia("(pointer: coarse)").matches, small = Math.min(innerWidth, innerHeight) < 700;
  if (coarse || small) return "low";
  return (navigator.hardwareConcurrency || 4) >= 8 ? "high" : "mid";
}

async function fetchJSON(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }

async function boot() {
  const scroll = createScroll({ reduced, snaps: SNAPS, onSnap: () => Sound.tick() });
  const hud = createHUD({ scroll, reduced });
  scroll.lock(true);
  wireChrome(scroll);

  const livePromise = getLive();
  livePromise.then((l) => showLive(l, hud));
  setInterval(() => getLive().then((l) => showLive(l, hud)), 60000);

  if (!webglOK()) { document.documentElement.classList.add("no-webgl"); finishLoading(scroll, null); return; }

  const tier = pickTier();
  document.documentElement.dataset.tier = tier;
  const canvas = $("stage");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const dpr = Math.min(devicePixelRatio, tier === "high" ? 1.75 : tier === "mid" ? 1.3 : 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = tier !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // loading: textures + the NASA model through a LoadingManager, data files by fetch
  const pct = { assets: 0, warm: 0, shown: 0 };
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, done, total) => (pct.assets = done / total);
  // the classroom (glTF props, PBR textures, the HDRI: ~16 MB) streams in behind the first chapters instead of
  // holding the enter button; its shaders compile in the background as soon as it has arrived
  const lateManager = new THREE.LoadingManager();
  let roomLoaded = false, running = false;
  const precompileRoom = () => renderer.compileAsync(worlds.room.scene, worlds.room.camera).catch(() => {});
  lateManager.onLoad = () => { roomLoaded = true; if (running) precompileRoom(); };
  const [smoke, princetonData] = await Promise.all([fetchJSON("assets/data/smoke-2023.json"), fetchJSON("assets/data/princeton.json")]);
  const assetsDone = new Promise((res) => { manager.onLoad = res; setTimeout(res, 20000); });
  const loaderTick = setInterval(() => {
    pct.shown += (pct.assets * 0.78 + pct.warm * 0.22 - pct.shown) * 0.25;
    $("load-pct").textContent = Math.min(99, Math.round(pct.shown * 100)) + "%";
    $("load-bar").style.transform = `scaleX(${pct.shown.toFixed(3)})`;
  }, 50);

  const worlds = {
    earth: createEarth({ manager, tier, smoke, renderer }),
    princeton: createPrinceton({ data: princetonData, tier, renderer }),
    room: createRoom({ renderer, tier, manager: lateManager }),
  };
  const order = ["earth", "princeton", "room"];
  const post = createPost(renderer, tier, worlds.earth.scene, worlds.earth.camera);
  post.setSize(innerWidth, innerHeight);

  // one CSS2D layer per world, so a world's labels disappear with it
  const labelRoot = $("labels");
  const css = Object.fromEntries(order.map((k) => {
    const r = new CSS2DRenderer(); r.setSize(innerWidth, innerHeight); r.domElement.className = "label-layer"; labelRoot.appendChild(r.domElement); return [k, r];
  }));

  function worldAt(T) { return T < CURTAINS[0][2] ? "earth" : T < CURTAINS[1][2] ? "princeton" : "room"; }
  let live = null;
  livePromise.then((l) => (live = l));
  setInterval(() => getLive().then((l) => { if (l) live = l; }), 60000);

  await assetsDone;
  // warm-up: render every world at a few poses so shaders compile now, not mid-scroll
  const warmTs = [0.2, 0.6, 1.5, 2.4, 3.0, 3.6, 4.4, 5.2, 5.9, 6.3, 7.4, 8.5];
  for (let i = 0; i < warmTs.length; i++) {
    const T = warmTs[i], w = worlds[worldAt(T)];
    w.update(T, 0.016, 0, hud, live, null);
    post.setWorld(w); post.tickWorld(T);
    renderer.compile(w.scene, w.camera);
    post.composer.render(0.016);
    pct.warm = (i + 1) / warmTs.length;
    await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 80); }); // don't stall in a background tab
  }
  pct.assets = 1;
  clearInterval(loaderTick);
  $("load-pct").textContent = "100%"; $("load-bar").style.transform = "scaleX(1)";

  // ---- render loop ----
  let active = null, lastCurtain = -1, frames = 0, slow = 0, time = 0;
  const reducedPose = [0.56, 1.6, 2.8, 3.5, 4.75, 5.95, 6.1, 7.15, 8.5];
  function frame(t, deltaMs) {
    const dt = Math.min(0.05, deltaMs / 1000);
    time += dt;
    scroll.update(dt);
    let T = scroll.T;
    if (!Number.isFinite(T)) T = 0;
    if (reduced) T = reducedPose[clamp(Math.floor(T), 0, reducedPose.length - 1)];
    const key = worldAt(T), w = worlds[key];
    if (key !== active) {
      active = key;
      post.setWorld(w);
      renderer.toneMappingExposure = w.exposure;
      [post.bloom.strength, post.bloom.radius, post.bloom.threshold] = w.bloom;
      order.forEach((k) => (css[k].domElement.style.display = k === key ? "" : "none"));
      document.documentElement.dataset.world = key;
    }
    w.update(T, dt, time, hud, live, Sound);
    post.tickWorld(T);

    let cover = 0, color = null;
    CURTAINS.forEach(([a, b, , c], i) => {
      if (T > a && T < b) {
        cover = range(T, a, b); color = c;
        if (lastCurtain !== i) { lastCurtain = i; Sound.whoosh(1.8); }
      }
    });
    if (cover === 0 && (T < CURTAINS[0][0] || T > CURTAINS[1][1] || (T > CURTAINS[0][1] && T < CURTAINS[1][0]))) lastCurtain = -1;
    post.setCurtain(cover, color, time);
    post.tick(time);
    post.composer.render(dt);
    css[key].render(w.scene, w.camera);
    hud.update(T);
    if (T < 7 || T >= 8) hud.verdict(null);

    // drop quality if the device is struggling
    if (++frames > 120 && frames < 400) {
      if (dt > 0.03) slow++;
      if (frames === 399 && slow > 160) {
        renderer.setPixelRatio(Math.max(0.8, renderer.getPixelRatio() * 0.75));
        post.setSize(innerWidth, innerHeight);
        if (post.grain) post.grain.enabled = false;
      }
    }
  }

  window.addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
    order.forEach((k) => { const c = worlds[k].camera; c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); css[k].setSize(innerWidth, innerHeight); });
    scroll.measure();
  });
  order.forEach((k) => { const c = worlds[k].camera; c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); });

  if (scroll.lenis) {
    gsap.ticker.add((t) => scroll.lenis.raf(t * 1000));
  }
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add((t, d) => frame(t, d));
  window.__story = { setT: (T) => scroll.scrollToT(T, { immediate: true }), get T() { return scroll.T; }, ...(params.has("debug") ? { post, worlds } : {}) };
  finishLoading(scroll, worlds);
  running = true;
  if (roomLoaded) precompileRoom();
  // stream the 8K Earth maps once the story is running
  setTimeout(() => order.forEach((k) => worlds[k].upgrade?.()), 1500);
}

function finishLoading(scroll, worlds) {
  const loader = $("loader"), enter = $("enter");
  loader.dataset.ready = "true";
  if (!worlds) { // no WebGL: say so plainly and offer the text version
    $("load-pct").textContent = "";
    loader.querySelector(".load-what").textContent = "3D isn't available in this browser, so the story opens as text.";
    loader.querySelector(".load-progress").hidden = true;
    enter.textContent = "Read the story";
  }
  enter.disabled = false;
  const go = () => {
    Sound.toggle($("sound-pref").getAttribute("aria-pressed") === "true");
    syncSoundButtons();
    loader.dataset.open = "true";
    scroll.lock(false);
    document.documentElement.classList.add("entered");
    setTimeout(() => { loader.hidden = true; }, 1400);
    const t = parseFloat(params.get("t"));
    if (!Number.isNaN(t)) scroll.scrollToT(t, { immediate: true });
    $("story").focus({ preventScroll: true });
  };
  enter.addEventListener("click", go, { once: true });
  if (params.has("autoenter")) go();
}

function syncSoundButtons() {
  document.querySelectorAll("[data-sound]").forEach((b) => {
    b.setAttribute("aria-pressed", String(Sound.on));
    const label = b.querySelector("[data-sound-label]");
    if (label) label.textContent = Sound.on ? "Sound on" : "Sound off";
  });
}

function wireChrome(scroll) {
  $("sound-pref").addEventListener("click", (e) => {
    const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("[data-sound-label]").textContent = on ? "Sound on" : "Sound off";
  });
  document.querySelectorAll("[data-sound]").forEach((b) => b.addEventListener("click", () => { Sound.toggle(); syncSoundButtons(); }));
  document.querySelectorAll("#rail [data-go]").forEach((b) => b.addEventListener("click", () => scroll.scrollToT(+b.dataset.go + 0.04)));
  document.querySelectorAll("[data-restart]").forEach((b) => b.addEventListener("click", () => scroll.scrollToT(0, { duration: 3.5 })));
}

const VERDICT_TEXT = { open: "Open the window.", either: "Either way.", shut: "Keep it shut.", ventilate: "Ventilate now." };
const VERDICT_WHY = {
  open: "The sky is cleaner than the room. Let it in.",
  either: "Inside and outside are about the same, so it makes little difference.",
  shut: "The air outside is worse than the room. Keep the windows shut.",
  ventilate: "The room just spiked. Open up until it clears.",
};
const STRETCH = { open: 125, either: 94, shut: 62, ventilate: 112 };

function showLive(l, hud) {
  if (!l) { hud.set("phs-live", "Live data unavailable right now."); hud.set("now-note", "Live data is unavailable right now. Open the dashboard to retry."); return; }
  const aqi = l.aqi != null ? Math.round(l.aqi) : null, wind = l.wind != null ? Math.round(l.wind) : null;
  const when = formatTime(new Date(l.at));
  const windTxt = wind != null ? `wind ${wind} km/h${l.windFrom ? " from the " + l.windFrom : ""}` : "";
  hud.set("phs-live", `Right now: AQI ${aqi ?? "?"}${windTxt ? ", " + windTxt : ""}.`);
  hud.set("live-aqi", aqi != null ? String(aqi) : "?");
  hud.set("live-wind", windTxt ? windTxt.charAt(0).toUpperCase() + windTxt.slice(1) : "");
  hud.set("live-aod", l.aod != null ? l.aod.toFixed(2) : "?");
  const v = VERDICT_TEXT[l.verdict] ? l.verdict : "either";
  const word = document.getElementById("now-verdict");
  if (word) { word.textContent = VERDICT_TEXT[v]; word.dataset.v = v; word.style.fontStretch = STRETCH[v] + "%"; }
  hud.set("now-why", VERDICT_WHY[v]);
  const roomTxt = l.stale != null ? `, room ${Math.round(l.stale)} of 100${l.mode !== "device" || l.mock ? " (simulated)" : ""}` : "";
  const src = l.mode === "device" ? (l.mock ? "from the Pi server, with simulated sensors" : "from the Raspberry Pi at PHS") : l.mode === "cached" ? "last saved reading" : "live sky, simulated room";
  hud.set("now-note", `AQI ${aqi ?? "?"} outside${roomTxt}. ${src.charAt(0).toUpperCase() + src.slice(1)}, ${when}.`);
}

boot();
