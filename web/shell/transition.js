// The hand-off from the story into the app: rewind, then dive.
//
//  Open the live window
//    rewind  the story plays backwards on a tape deck: every world along its real camera path, the curtains,
//            the satellite whipping back; tracking noise, a counter running down to 00:00:00, a motor whir
//    clunk   T = 0 exactly: the motor cuts, the frame jolts, the tape look snaps off
//    hold    the story's first shot, still: the start of the story again
//    fly     the same Earth turns and the camera arcs over Princeton
//    plunge  down to the height where it shows the same ground as the app's map at zoom 6 (radial blur);
//            it eases in and out, so it settles onto the map's scale and the map can surface almost full-frame
//    land    the map surfaces through the planet at the same scale and keeps flying in to the city;
//            the app's panels assemble
//  Back (the app's logo or the browser): the panels retract, the map flies out to zoom 6 and sinks back into
//  the story's Earth, and the camera pulls out to the first shot. The story scrolls from the top again.
//
// Everything runs on the shell's one render loop (frame()), so the camera, the picture's look, the counter,
// the map and the sound read the same clock.
import { rewindDuration, rewindT, speedAt, tapeCounter, chapterAt } from "./rewind.js";
import { distanceForGroundWidth, groundWidthAt, lookPose, blendPose } from "./dive.js";
import { loadApp } from "./app-loader.js";
import { viewport } from "./viewport.js";

const PHS = [40.3587, -74.656];
// seconds
const TIME = { fade: 0.25, tapeIn: 0.15, hold: 0.35, fly: 1.8, plunge: 1.3, overlap: 0.3, mapIn: 0.6, out: 2.0, mapOut: 0.7 };
const FOV = 30;          // the dive's lens (the story's first shot is 34)
const MID = 2.5;         // the fly ends this far from the centre (Earth radii), over Princeton
const FALLBACK_KM = 2700; // ground width of the map at zoom 6 on a laptop, if the map can't say

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const inOut3 = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export function createHandoff({ stage, story, scroll, sound, reduced, router, hud, worlds }) {
  const subs = new Set();
  const names = scroll.sections.map((s) => s.dataset.name || "");
  const rw = { box: $("rw"), glyph: $("rw-glyph"), label: $("rw-label"), count: $("rw-count"), ch: $("rw-ch") };
  let phase = null, t = 0, T0 = 0, D = 0, peak = 1, jolt = 0, app = null, appP = null, last = 0;
  let from = null, mid = null, end = null, widthKm = FALLBACK_KM, mapOn = false, pic = null, back = null, cuedPlunge = false;
  const pose = { p: [0, 0, 0], t: [0, 0, 0], fov: 34 }, tmp = { p: [0, 0, 0], t: [0, 0, 0], fov: 34 };

  const setMode = (m) => { root.dataset.mode = m; subs.forEach((fn) => fn(m)); };
  const aspect = () => viewport.w / viewport.h;

  // ---------------------------------------------------------------- the overlay (tape counter)
  function overlay(state, { glyph, label, count, ch } = {}) {
    if (!rw.box) return;
    if (!state) { gsap.to(rw.box, { opacity: 0, duration: 0.4, onComplete: () => { rw.box.hidden = true; } }); return; }
    rw.box.hidden = false; rw.box.dataset.state = state;
    gsap.killTweensOf(rw.box); gsap.set(rw.box, { opacity: 1 });
    if (glyph != null) rw.glyph.textContent = glyph;
    if (label != null) rw.label.textContent = label;
    if (count != null) rw.count.textContent = count;
    if (ch != null) rw.ch.textContent = ch;
  }

  // ---------------------------------------------------------------- the app's picture (map or globe) over the story
  /** a: 0..1 how much of the app's picture shows; s: its scale (the story's camera height, relative) */
  function picture(a, s = 1) {
    const el = pic === "globe" ? $("globe") : $("localmap");
    el.style.opacity = a.toFixed(3);
    $("vignette").style.opacity = a.toFixed(3);
    if (a >= 0.999 && Math.abs(s - 1) < 1e-3) { el.style.transform = el.style.filter = el.style.maskImage = el.style.webkitMaskImage = ""; return; }
    el.style.transform = `scale(${s.toFixed(4)})`;
    el.style.filter = a < 0.999 ? `blur(${((1 - a) * 6).toFixed(2)}px)` : "";
    // a soft ellipse around Princeton that grows until the picture fills the screen (closest-side: inside the patch's edges)
    const r = 30 + a * 150, m = a < 0.999 ? `radial-gradient(closest-side ellipse at 50% 50%, #000 ${(r - 60).toFixed(1)}%, transparent ${r.toFixed(1)}%)` : "";
    el.style.maskImage = m; el.style.webkitMaskImage = m;
  }
  function clearPicture() {
    for (const el of [$("globe"), $("localmap")]) el.style.transform = el.style.filter = el.style.maskImage = el.style.webkitMaskImage = "";
    $("vignette").style.opacity = "";
  }

  // ---------------------------------------------------------------- the dive's camera
  function divePoses() {
    const earth = worlds.earth;
    widthKm = app?.mapWidthKm?.() || FALLBACK_KM;
    const dir = norm(earth.surfacePoint(...PHS));
    end = lookPose(dir, distanceForGroundWidth(widthKm, FOV, aspect()), FOV);
    mid = lookPose(dir, Math.max(MID, Math.hypot(...end.p) * 1.4), FOV + 2);
  }
  /** the app's picture scale that matches the story camera's ground width right now */
  const scaleNow = (p) => clamp(widthKm / groundWidthAt(Math.hypot(...p.p), p.fov, aspect()), 0.3, 1);

  function renderEarth(p, dt, time, look = {}) {
    const w = stage.setActiveWorld("earth");
    w.update(0, dt, time, hud, story.live, null, { camera: p });
    stage.post.tickWorld(0);
    stage.post.setCurtain(0, null, time);
    stage.post.tick(time);
    stage.post.setRewind(look);
  }

  // ---------------------------------------------------------------- open: rewind, then dive
  function toApp({ instant = false } = {}) {
    if (phase === "out" || phase === "exit") { veilCut("app"); return; }
    if (phase) return;
    sound.cue?.("latch", { to: "ui", gain: 0.8 }); // the button press: a wooden latch
    scroll.lock(true);
    root.dataset.handoff = "in";
    $("story").inert = true;
    appP = loadApp().then((a) => { app = a; a.prepare(); return a; });
    appP.catch((e) => { console.error(e); abort(); });
    if (instant || reduced || !window.gsap) { veilCut("app"); return; }
    sound.prepareRewind?.();
    gsap.to(".js .copy", { opacity: 0, duration: TIME.fade, ease: "power1.out", overwrite: "auto" }); // (the header: transition.css)
    T0 = story.sceneT; D = rewindDuration(T0); t = 0;
    peak = speedAt(D / 2, T0, D) || 1;
    if (D > 0) {
      phase = "rewind";
      sound.rewind?.();
      overlay("rew", { glyph: "◀◀", label: "REW", count: tapeCounter(T0), ch: chapterAt(T0, names) });
    } else startHold();
    last = 0;
    bindSkip(true);
  }

  function startHold() {
    phase = "hold"; t = 0;
    scroll.scrollToT(0, { immediate: true });
    overlay("stop", { glyph: "■", label: "STOP", count: tapeCounter(0), ch: "" });
  }

  function clunk() {
    sound.rewindStop?.();
    jolt = 3; // frames
    startHold();
  }

  function startDive() {
    phase = "dive"; t = 0; cuedPlunge = false; mapOn = false; pic = "map";
    from = worlds.earth.pose();
    divePoses();
    sound.cue?.("swell", { gain: 0.55 }); // the same low air swell the story opened on
    sound.cue?.("whoosh-light", { gain: 0.5, when: 0.2 });
    overlay("link", { glyph: "▶", label: "SKY LINK", count: "PRINCETON HIGH SCHOOL", ch: "40.3587°N 74.6560°W" });
  }

  function land() {
    phase = null;
    clearPicture();
    $("localmap").style.opacity = 1;
    $("app").classList.add("shown");
    stage.post.setRewind({});
    overlay(null);
    app.enter({ via: "story" });
    finish("app");
  }

  // ---------------------------------------------------------------- back: pull out to the first shot
  async function toStory({ instant = false } = {}) {
    if (phase === "rewind" || phase === "hold" || phase === "dive") { veilCut("story"); return; }
    if (phase || root.dataset.mode !== "app") return;
    if (!app) { finish("story"); return; }
    if (instant || reduced || !window.gsap) { veilCut("story"); return; }
    phase = "exit";
    root.dataset.handoff = "out";
    pic = app.scene();
    await app.exit();
    if (phase !== "exit") return;
    if (pic === "map") await app.mapWide(0.8);
    else $("globe").style.opacity = 1;
    if (phase !== "exit") return;
    $("app").classList.remove("shown");
    $("app").classList.add("landing");
    scroll.scrollToT(0, { immediate: true });
    divePoses();
    back = worlds.earth.poseAt(0);
    phase = "out"; t = 0; last = 0;
    sound.cue?.("whoosh-light", { gain: 0.45 });
  }

  // ---------------------------------------------------------------- endings
  function finish(m) {
    phase = null; bindSkip(false);
    root.removeAttribute("data-handoff");
    stage.post.setRewind({});
    if (m === "app") {
      $("story").inert = true;
      setMode("app");
      announce("Live app");
    } else {
      app?.hide();
      $("app").classList.remove("landing", "shown");
      clearPicture();
      overlay(null);
      setMode("story");
      $("story").inert = false;
      scroll.lock(false);
      hud.update(0);
      $("story").focus({ preventScroll: true });
    }
  }

  /** a cut behind a black veil: reduced motion, a skip, or Back mid-move */
  function veilCut(to) {
    const veil = $("veil");
    bindSkip(false);
    phase = "veil";
    gsap.killTweensOf(veil);
    gsap.to(veil, { opacity: 1, duration: 0.12, ease: "none", onComplete: async () => {
      sound.rewindStop?.(true);
      scroll.scrollToT(0, { immediate: true });
      story.frame(0, 0, { T: 0, quiet: true });
      if (to === "app") {
        try { await (appP || (appP = loadApp().then((a) => { app = a; a.prepare(); return a; }))); } catch { abort(); return; }
        $("app").classList.add("landing");
        land();
      } else {
        if (app?.active) await app.exit({ reduced: true });
        finish("story");
      }
      gsap.to(veil, { opacity: 0, duration: 0.18, ease: "none", delay: 0.05 });
    } });
  }

  /** the app couldn't load: stay in the story */
  function abort() {
    phase = null; bindSkip(false);
    sound.rewindStop?.(true);
    root.removeAttribute("data-handoff");
    stage.post.setRewind({});
    overlay(null);
    if (router.mode === "app") history.back();
    finish("story");
  }

  // a click, Esc or a resize during the move jumps to its end
  const skip = (e) => { if (e.type === "keydown" && e.key !== "Escape") return; if (phase === "rewind" || phase === "hold" || phase === "dive") veilCut("app"); };
  function bindSkip(on) {
    for (const ev of ["pointerdown", "keydown"]) document[on ? "addEventListener" : "removeEventListener"](ev, skip, true);
    window[on ? "addEventListener" : "removeEventListener"]("resize", skip);
  }

  const sr = $("sr-announce");
  function announce(text) { if (sr) { sr.textContent = ""; setTimeout(() => (sr.textContent = text), 60); } }

  // ---------------------------------------------------------------- every frame while it runs
  // The move keeps wall-clock time even when frames are slow (the shell caps dt for the worlds' physics),
  // so a laptop drawing 20 fps still rewinds in under three seconds.
  function tick() {
    const now = performance.now(), d = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    return d;
  }
  function frame(dt, time) {
    const rdt = tick();
    if (phase === "rewind") {
      t += rdt;
      const T = rewindT(t, T0, D), v = clamp(speedAt(t, T0, D) / peak);
      story.frame(dt, time, { T, quiet: true });
      stage.post.setRewind({ amt: smooth(0, TIME.tapeIn, t), speed: v });
      sound.rewindSpeed?.(v, dt);
      rw.count.textContent = tapeCounter(T);
      const ch = chapterAt(T, names);
      if (rw.ch.textContent !== ch) rw.ch.textContent = ch;
      if (t >= D) clunk();
      return;
    }
    if (phase === "hold") {
      t += rdt;
      story.frame(dt, time, { T: 0, quiet: true });
      stage.post.setRewind({ jolt: jolt > 0 ? (jolt === 3 ? 0.014 : jolt === 2 ? -0.007 : 0.003) : 0 });
      if (jolt > 0) jolt--;
      sound.quiet?.(dt);
      if (t >= TIME.hold && app && phase === "hold") startDive();
      return;
    }
    if (phase === "dive") {
      t += rdt;
      const k1 = inOut3(clamp(t / TIME.fly));
      blendPose(from, mid, k1, tmp);
      const p0 = TIME.fly - TIME.overlap, kl = clamp((t - p0) / TIME.plunge), k2 = inOut3(kl);
      blendPose(tmp, end, k2, pose);
      if (kl > 0 && !cuedPlunge) { cuedPlunge = true; sound.cue?.("whoosh", { gain: 0.8 }); }
      const zoom = Math.sin(Math.PI * kl) ** 1.5 * 0.85; // strongest where the plunge is fastest
      renderEarth(pose, dt, time, { zoom, center: [0.5, 0.5] });
      sound.quiet?.(dt);
      // the map surfaces through the planet for the plunge's last part, at the camera's scale
      const a = smooth(1 - TIME.mapIn / TIME.plunge, 1, kl);
      if (a > 0) {
        if (!mapOn) { mapOn = true; $("app").classList.add("landing"); }
        picture(a, scaleNow(pose));
      }
      if (kl >= 1) land();
      return;
    }
    if (phase === "out") {
      t += rdt;
      const k = inOut3(clamp(t / TIME.out));
      blendPose(end, back, k, pose);
      renderEarth(pose, dt, time);
      const a = 1 - smooth(0, TIME.mapOut, t);
      picture(a, pic === "globe" ? 1 : scaleNow(pose)); // the map sinks back into the planet; the globe just fades
      if (k >= 1) finish("story");
    }
  }

  return {
    get running() { return phase !== null; },
    /** sound during the move: the rewind and the dive drive it themselves */
    get phase() { return phase; },
    onModeChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    toApp, toStory, frame,
    /** the app opened: wire its logo to Back */
    attachApp(a) { app = a; },
  };
}
