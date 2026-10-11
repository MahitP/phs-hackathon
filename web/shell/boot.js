// SkyWindow app shell: one page for the scroll story and the app.
// index.html and app.html are the same document; the URL picks where it starts (app.html or ?live).
// Boot: tier, stage, worlds, warm-up, the loader, and the single render loop.
// The story's "Open the live window" rewinds the story and dives into the app (transition.js);
// app.html on its own opens the app straight away, with the app's own globe intro and no story behind it.
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
import { createHandoff } from "./transition.js";
import { createGovernor } from "./governor.js";
import { loadApp, whenAppLoads } from "./app-loader.js";

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
let shellReady = false; // until the render loop runs, the links stay plain page loads

async function fetchJSON(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }

/** the app uses the shell's sound engine: its SOUND button, and the wind it reads */
whenAppLoads((app) => app.useSound({ toggle: () => Sound.toggle(), on: () => Sound.on, setWind: (w) => Sound.setWind(w) }));

async function boot() {
  const scroll = createScroll({ reduced, snaps: SNAPS, onSnap: () => Sound.tick() });
  const hud = createHUD({ scroll, reduced });
  scroll.lock(true);
  wireChrome(scroll);
  store.start("story"); // the story's Right now chapter; the app polls for itself while it's open

  if (startMode === "app") return coldApp();

  if (!webglOK()) {
    root.classList.add("no-webgl");
    store.subscribe((s) => storyText(s, hud));
    finishLoading(scroll, false);
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

  const worlds = stage.worlds;
  const loaderTick = setInterval(() => {
    pct.shown += (pct.assets * 0.78 + pct.warm * 0.22 - pct.shown) * 0.25;
    $("load-pct").textContent = Math.min(99, Math.round(pct.shown * 100)) + "%";
    $("load-bar").style.transform = `scaleX(${pct.shown.toFixed(3)})`;
  }, 50);
  const assetsDone = new Promise((res) => { manager.onLoad = res; setTimeout(res, 20000); });
  const [smoke, princetonData] = await Promise.all([fetchJSON("assets/data/smoke-2023.json"), fetchJSON("assets/data/princeton.json")]);
  stage.addWorld("earth", createEarth({ manager, tier, smoke, renderer }));
  stage.addWorld("princeton", createPrinceton({ data: princetonData, tier, renderer }));
  stage.addWorld("room", createRoom({ renderer, tier, manager: lateManager }));
  const storyMode = createStoryMode({ stage, scroll, hud, sound: Sound, reduced });
  store.subscribe((s) => storyMode.setLive(s.live));
  if (store.get().live) storyMode.setLive(store.get().live); // a reading that came in while the worlds loaded

  await assetsDone;
  // the Earth's 8K maps go up behind the loader (uploading them mid-story froze a frame for ~0.7 s)
  await Promise.race([worlds.earth?.upgrade?.() ?? Promise.resolve(), new Promise((r) => setTimeout(r, 10000))]);
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
  // the hand-off's tape look and zoom blur: compile their shader now too
  stage.post.setRewind({ amt: 1, speed: 0.5 }); stage.post.composer.render(0.016); stage.post.setRewind({});
  pct.assets = 1;
  clearInterval(loaderTick);
  $("load-pct").textContent = "100%"; $("load-bar").style.transform = "scaleX(1)";

  // ---- the shell's modes and the one render loop ----
  const handoff = createHandoff({ stage, story: storyMode, scroll, sound: Sound, reduced, router, hud, worlds });
  let mode = "story", time = 0, prefetched = false, rewindReady = false;
  const governor = createGovernor({ stage, tier });
  // the app's STORY button and logo: back to the very start (the title screen), behind a quick fade
  whenAppLoads((app) => app.onExit(() => {
    gsap.to("#veil", { opacity: 1, duration: 0.3, ease: "none", onComplete: () => location.assign(router.urlFor("story")) });
  }));
  const autoplay = createAutoplay(scroll, () => mode);

  function frame(_t, deltaMs) {
    const dt = Math.min(0.05, deltaMs / 1000);
    time += dt;
    if (mode === "story" && !handoff.running) autoplay.frame(dt);
    if (handoff.running) handoff.frame(dt, time);
    else if (mode === "story") storyMode.frame(dt, time);
    // in the app the story's canvas is hidden: don't render it
    if (mode === "story" || handoff.running) stage.render(dt);
    // sound follows the same frame: the story's cue sheet, or the app's live weather (the hand-off drives its own)
    const cam = stage.worlds[stage.active]?.camera;
    if (handoff.running) { if (handoff.phase === "veil" || handoff.phase === "exit") Sound.quiet(dt); }
    else if (mode === "story") Sound.story(storyMode.sceneT, dt, { raise: worlds.room?.win.raise ?? 0, camera: cam, world: stage.active, satellite: worlds.earth?.satellite, live: storyMode.live });
    else Sound.app(dt, { live: store.get().live });

    if (mode === "story" && !handoff.running) {
      // near the end, get the app ready in the background (scripts, globe, the map's tiles at zoom 6)
      if (!prefetched && storyMode.T > 7) { prefetched = true; idle(() => loadApp().then((a) => a.prepare()).catch(() => {})); }
      if (!rewindReady && storyMode.T > 8) { rewindReady = true; Sound.prepareRewind(); }
    }
    // keep each world near 60 fps: the governor trades resolution for frame rate where it has to
    governor.frame(deltaMs, stage.active, { busy: handoff.running || !running || mode === "app" });
  }
  stage.onResize(() => scroll.measure());

  handoff.onModeChange((m) => { mode = m; root.dataset.mode = m; });
  router.onChange((to, { instant } = {}) => {
    if (to === "app" && mode === "story") {
      if (!root.classList.contains("entered")) { // from the loader (the skip link): open it on the way
        $("loader").dataset.open = "true"; root.classList.add("entered"); setTimeout(() => { $("loader").hidden = true; }, 1400);
      }
      handoff.toApp({ instant });
    }
    else if (to === "story" && (mode === "app" || handoff.running)) handoff.toStory({ instant });
  });

  if (scroll.lenis) gsap.ticker.add((t) => scroll.lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add(frame);
  shellReady = true;
  window.__story = { setT: (T) => scroll.scrollToT(T, { immediate: true }), get T() { return scroll.T; }, ...(params.has("debug") ? { stage, worlds, handoff, store, sound: Sound, governor } : {}) };

  finishLoading(scroll, true);
  running = true;
  if (roomLoaded) renderer.compileAsync(worlds.room.scene, worlds.room.camera).catch(() => {});
  else roomReady.then(() => renderer.compileAsync(worlds.room.scene, worlds.room.camera).catch(() => {}));
  // stream the 8K Earth maps once the story is running
  setTimeout(() => ["earth", "princeton", "room"].forEach((k) => worlds[k].upgrade?.()), 1500);
}

/** Story mode: the story scrolls itself at an even pace, like a video (about 95 s from the top to Right now).
 *  Any scroll, touch or key hands control back. */
function createAutoplay(scroll, getMode) {
  const btn = $("btn-autoplay"), label = btn?.querySelector("[data-autoplay-label]");
  let on = false, px = 0, speed = 0;
  const setOn = (v) => {
    on = v;
    btn?.setAttribute("aria-pressed", String(v));
    if (label) label.textContent = v ? "Pause" : "Story mode";
  };
  const go = (y) => (scroll.lenis ? scroll.lenis.scrollTo(y, { immediate: true, force: true }) : window.scrollTo(0, y));
  const now = () => (scroll.lenis ? scroll.lenis.animatedScroll : window.scrollY);
  function start() {
    const end = scroll.pxAt(END_T), top = scroll.pxAt(0);
    px = now();
    if (px >= end - 4) { px = top; go(top); } // at the end already: from the top
    speed = (end - top) / 95;
    setOn(true);
  }
  btn?.addEventListener("click", () => (on ? setOn(false) : start()));
  const stop = (e) => { if (on && !(e.target instanceof Element && e.target.closest("#btn-autoplay"))) setOn(false); };
  for (const ev of ["wheel", "touchstart"]) window.addEventListener(ev, stop, { passive: true });
  window.addEventListener("keydown", (e) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", " ", "Home", "End"].includes(e.key)) stop(e); });
  return {
    frame(dt) {
      if (!on) return;
      if (getMode() !== "story") { setOn(false); return; }
      const end = scroll.pxAt(END_T);
      px = Math.min(end, px + speed * dt);
      go(px);
      if (px >= end) setOn(false); // Right now: the end of the film
    },
  };
}

const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));

/** app.html: the app on its own, with the globe's intro (orbit -> Princeton -> into the map). The logo loads the story. */
async function coldApp() {
  root.dataset.appCold = "true";
  $("loader").hidden = true;
  $("story").inert = true;
  try {
    const app = await loadApp();
    app.onExit(() => location.assign(router.urlFor("story")));
    app.enter({ via: "cold", reduced });
    gsap.ticker.add((_t, deltaMs) => Sound.app(Math.min(0.05, deltaMs / 1000), { live: store.get().live }));
  } catch (e) {
    console.error(e);
    location.assign(router.urlFor("story")); // the app couldn't load: the story still can
  }
}

/** "Open the live window", "Skip to the live window": a plain left click moves within the page; other clicks open normally. */
function wireLinks() {
  const handle = (to) => (e) => {
    if (!shellReady || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.go(to);
  };
  document.querySelectorAll("[data-to-live]").forEach((a) => a.addEventListener("click", handle("app")));
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
