// SkyWindow app shell: one page for the scroll story and the live window.
// index.html and app.html are the same document; the URL picks where it starts (app.html or ?live).
// Boot: tier, stage, worlds, warm-up, the loader, and the single render loop.
import * as THREE from "three";
import { createStage, pickTier, webglOK } from "./stage.js";
import { createStore } from "./store.js";
import { createRouter } from "./router.js";
import { createScroll } from "../story/scroll.js";
import { createHUD } from "../story/hud.js";
import { Sound } from "./audio/engine.js";
import { wireSoundPanel } from "./audio/panel.js";
import { createStoryMode, SNAPS, worldAt, END_T } from "../story/mode.js";
import { createEarth } from "../story/worlds/earth.js";
import { createPrinceton } from "../story/worlds/princeton.js";
import { createRoom } from "../story/worlds/room.js";
import { createLiveMode } from "../live/mode.js";
import { createHandoff } from "./transition.js";
import { createGovernor } from "./governor.js";

const params = new URLSearchParams(location.search);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
root.classList.add("js");

// sky-local.js declares `const LocalSky` in a classic script: a global binding, not a window property
const localSky = typeof LocalSky !== "undefined" ? LocalSky : null; // eslint-disable-line no-undef

const router = createRouter();
const startMode = router.mode;
root.dataset.mode = startMode;
const store = createStore({ localSky });

async function fetchJSON(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }

async function boot() {
  const scroll = createScroll({ reduced, snaps: SNAPS, onSnap: () => Sound.tick() });
  const hud = createHUD({ scroll, reduced });
  scroll.lock(true);
  wireChrome(scroll);
  store.start(startMode);

  const live = createLiveMode({ store, sound: Sound, reduced, router });
  if (startMode === "live") {
    // straight into the live window: no cinematic loader, readable text at once, the room fades in behind it
    $("loader").hidden = true;
    root.classList.add("entered");
    root.dataset.liveCold = "true";
    live.showStatic();
  }

  if (!webglOK()) {
    root.classList.add("no-webgl");
    store.subscribe((s) => storyText(s, hud));
    if (startMode === "story") finishLoading(scroll, false);
    return;
  }

  wireLinks(); // without WebGL the links stay plain page loads
  const tier = pickTier(params);
  root.dataset.tier = tier;
  Sound.setTier(tier);
  const stage = createStage({ canvas: $("stage"), labelRoot: $("labels"), tier });
  const { renderer } = stage;

  // loading: textures + the NASA model through a LoadingManager, data files by fetch
  const pct = { assets: 0, warm: 0, shown: 0 };
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, done, total) => (pct.assets = done / total);
  // the classroom (glTF props, PBR textures, the HDRI: ~16 MB) streams in behind the first chapters instead of
  // holding the enter button; its shaders compile in the background as soon as it has arrived
  const lateManager = new THREE.LoadingManager();
  let roomLoaded = false, running = false;
  const roomReady = new Promise((res) => { lateManager.onLoad = () => { roomLoaded = true; res(); }; });

  let storyMode = null;
  const worlds = stage.worlds;
  const makeStoryWorlds = async () => {
    const [smoke, princetonData] = await Promise.all([fetchJSON("assets/data/smoke-2023.json"), fetchJSON("assets/data/princeton.json")]);
    if (!worlds.earth) stage.addWorld("earth", createEarth({ manager, tier, smoke, renderer }));
    if (!worlds.princeton) stage.addWorld("princeton", createPrinceton({ data: princetonData, tier, renderer }));
  };

  if (startMode === "story") {
    const loaderTick = setInterval(() => {
      pct.shown += (pct.assets * 0.78 + pct.warm * 0.22 - pct.shown) * 0.25;
      $("load-pct").textContent = Math.min(99, Math.round(pct.shown * 100)) + "%";
      $("load-bar").style.transform = `scaleX(${pct.shown.toFixed(3)})`;
    }, 50);
    const assetsDone = new Promise((res) => { manager.onLoad = res; setTimeout(res, 20000); });
    await makeStoryWorlds();
    stage.addWorld("room", createRoom({ renderer, tier, manager: lateManager }));
    storyMode = createStoryMode({ stage, scroll, hud, sound: Sound, reduced });
    store.subscribe((s) => { storyMode.setLive(s.live); live.setData(s); });

    await assetsDone;
    // warm-up: render every world at a few poses so shaders compile now, not mid-scroll
    const warmTs = [0.2, 0.6, 1.5, 2.4, 3.0, 3.6, 4.4, 5.2, 5.9, 6.3, 7.4, 8.5];
    for (let i = 0; i < warmTs.length; i++) {
      const T = warmTs[i], w = stage.setActiveWorld(worldAt(T));
      w.update(T, 0.016, 0, hud, storyMode.live, null);
      stage.post.tickWorld(T);
      renderer.compile(w.scene, w.camera);
      stage.post.composer.render(0.016);
      pct.warm = (i + 1) / warmTs.length;
      await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 80); }); // don't stall in a background tab
    }
    pct.assets = 1;
    clearInterval(loaderTick);
    $("load-pct").textContent = "100%"; $("load-bar").style.transform = "scaleX(1)";
  } else {
    // cold start in the live window: only the window wall first; the story's worlds stream in when idle
    stage.addWorld("room", createRoom({ renderer, tier, manager: lateManager }));
    storyMode = createStoryMode({ stage, scroll, hud, sound: Sound, reduced });
    store.subscribe((s) => { storyMode.setLive(s.live); live.setData(s); });
  }

  // ---- the shell's modes and the one render loop ----
  live.attach({ stage, room: worlds.room, hud });
  const handoff = createHandoff({ stage, story: storyMode, live, scroll, store, sound: Sound, reduced, router, room: worlds.room });
  let mode = startMode, time = 0;
  const governor = createGovernor({ stage, tier });

  function frame(_t, deltaMs) {
    const dt = Math.min(0.05, deltaMs / 1000);
    time += dt;
    if (handoff.running) handoff.frame(dt, time);
    else if (mode === "story") storyMode.frame(dt, time);
    else live.frame(dt, time);
    stage.render(dt);
    // sound follows the same frame: the story's cue sheet, or the live window's weather
    const cam = stage.worlds[stage.active]?.camera;
    if (mode === "story" && !handoff.running) Sound.story(storyMode.sceneT, dt, { raise: worlds.room?.win.raise ?? 0, camera: cam, world: stage.active, satellite: worlds.earth?.satellite, live: storyMode.live });
    else Sound.live(dt, { live: live.data?.live, raise: worlds.room?.win.raise ?? 0, camera: cam });
    if (mode === "live" || handoff.running) live.afterRender(dt, time);

    // keep each world near 60 fps: the governor trades resolution for frame rate where it has to
    governor.frame(deltaMs, stage.active, { busy: handoff.running || !running });
  }
  stage.onResize(() => scroll.measure());

  handoff.onModeChange((m) => { mode = m; root.dataset.mode = m; store.setMode(m); });
  router.onChange((to, { instant } = {}) => {
    if (to === "live" && mode === "story") handoff.toLive({ instant });
    else if (to === "story" && mode === "live") handoff.toStory({ instant });
  });

  if (scroll.lenis) gsap.ticker.add((t) => scroll.lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add(frame);
  window.__story = { setT: (T) => scroll.scrollToT(T, { immediate: true }), get T() { return scroll.T; }, ...(params.has("debug") ? { stage, worlds, live, handoff, store, sound: Sound, governor } : {}) };

  if (startMode === "story") {
    finishLoading(scroll, true);
    running = true;
    if (roomLoaded) renderer.compileAsync(worlds.room.scene, worlds.room.camera).catch(() => {});
    else roomReady.then(() => renderer.compileAsync(worlds.room.scene, worlds.room.camera).catch(() => {}));
    // stream the 8K Earth maps once the story is running
    setTimeout(() => ["earth", "princeton", "room"].forEach((k) => worlds[k].upgrade?.()), 1500);
  } else {
    live.enterCold();
    await Promise.race([roomReady, new Promise((r) => setTimeout(r, 25000))]);
    await renderer.compileAsync(worlds.room.scene, worlds.room.camera).catch(() => {});
    delete root.dataset.liveCold;
    live.reveal();
    running = true;
    // the story's worlds, for Back and for zooming out, when the browser is idle
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    idle(() => makeStoryWorlds().then(() => ["earth", "princeton"].forEach((k) => worlds[k].upgrade?.())));
  }

}

/** "Open the live window", "Replay the story": a plain left click moves within the page; other clicks open normally. */
function wireLinks() {
  const handle = (to) => (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.go(to);
  };
  document.querySelectorAll("[data-to-live]").forEach((a) => a.addEventListener("click", handle("live")));
  document.querySelectorAll("[data-to-story]").forEach((a) => a.addEventListener("click", handle("story")));
}

function storyText(s, hud) { import("../story/mode.js").then((m) => m.showLive(s.live, hud)); }

function finishLoading(scroll, hasWebGL) {
  const loader = $("loader"), enter = $("enter");
  loader.dataset.ready = "true";
  if (!hasWebGL) { // no WebGL: say so plainly and offer the text version
    $("load-pct").textContent = "";
    loader.querySelector(".load-what").textContent = "3D isn't available in this browser, so the story opens as text.";
    loader.querySelector(".load-progress").hidden = true;
    enter.textContent = "Read the story";
  }
  enter.disabled = false;
  const go = () => {
    Sound.toggle($("sound-pref").getAttribute("aria-pressed") === "true");
    Sound.begin(); // the bands part on a low air swell; Penumbra fades in
    syncSoundButtons();
    loader.dataset.open = "true";
    scroll.lock(false);
    root.classList.add("entered");
    setTimeout(() => { loader.hidden = true; }, 1400);
    const t = parseFloat(params.get("t"));
    if (!Number.isNaN(t)) scroll.scrollToT(t, { immediate: true });
    $("story").focus({ preventScroll: true });
  };
  enter.addEventListener("click", go, { once: true });
  if (params.has("autoenter")) go();
}

export function syncSoundButtons() {
  document.querySelectorAll("[data-sound]").forEach((b) => {
    b.setAttribute("aria-pressed", String(Sound.on));
    const label = b.querySelector("[data-sound-label]");
    if (label) label.textContent = Sound.on ? "Sound on" : "Sound off";
    b.setAttribute("aria-label", Sound.on ? "Sound on (M to mute)" : "Sound off (M to turn on)");
  });
}

function wireChrome(scroll) {
  $("sound-pref").addEventListener("click", (e) => {
    const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("[data-sound-label]").textContent = on ? "Sound on, best with headphones" : "Sound off";
  });
  document.querySelectorAll("[data-sound]").forEach((b) => b.addEventListener("click", () => Sound.toggle()));
  document.addEventListener("skywindow:sound", syncSoundButtons); // the buttons, M, or the mix panel
  wireSoundPanel(Sound);
  document.querySelectorAll("#rail [data-go]").forEach((b) => b.addEventListener("click", () => scroll.scrollToT(+b.dataset.go + 0.04)));
  document.querySelectorAll("[data-restart]").forEach((b) => b.addEventListener("click", () => scroll.scrollToT(0, { duration: 3.5 })));
}

export { END_T };
boot();
