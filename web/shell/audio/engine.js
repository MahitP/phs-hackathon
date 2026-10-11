// SkyWindow's sound. One AudioContext; four buses (music, ambience, effects, interface) into a limiter.
// The score streams through <audio> elements, two per track, crossfaded at the loop seam, so nothing
// large is decoded into memory; beds and effects are decoded buffers with sample-exact loop points
// (assets/audio/cues.json, built by scripts/fetch_audio.py). Sounds with a place in the room (the wall
// clock, the sash, the device's speaker, the window) are positioned in 3D and the listener rides the
// camera. What plays when is decided in cues.js; this file only makes it sound.
//
// Keeps the old API (on, toggle, setWind, whoosh, tick, chime), so callers didn't change.
import * as THREE from "three";
import { storyMix, liveMix, appMix, crossings, STORY_SHOTS, OUTDOOR, BEDS } from "./cues.js";

const BASE = new URL("../../assets/audio/", import.meta.url).href;
/** where things are in the classroom (metres; the window is in the wall at z = 0, the room is z < 0) */
const PLACES = { window: [0, 1.75, 0.3], sash: [0, 1.0, -0.02], device: [0.1, 0.98, -0.3], clock: [0, 2.67, -8.55] };
/** trims under the visitor's sliders, so 0.8 on every slider is a balanced mix */
const TRIM = { music: 0.75, ambience: 1.0, effects: 0.8, ui: 0.55 };
const ONCE = new Set(["dawn-end"]); // the last phrase plays once and ends
const KEY = "skywindow-sound";
const SHOT_MARKS = STORY_SHOTS.map((s) => s[0]);
const dbToGain = (db) => 10 ** (db / 20);
/** glide a parameter toward v, but only schedule anything when v has actually moved (this runs every frame) */
function glide(param, v, tc, eps = 1e-3) {
  if (param._to !== undefined && Math.abs(param._to - v) <= eps * Math.max(1, Math.abs(v))) return;
  param._to = v;
  param.setTargetAtTime(v, ctx.currentTime, tc);
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

const settings = { music: 0.8, ambience: 0.8, effects: 0.8, liveMusic: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* private window: defaults */ }
const saveSettings = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* fine */ } };

let ctx = null, tier = "mid", on = false, cues = null, cuesP = null;
let master, limiter, duckAll, musicFilter, musicDuck, outIn, outLP, outGain, outAround, outWindow;
const bus = {}, places = {}, buffers = new Map(), beds = {}, tracks = {};
let current = null, lastT = null, lastRaise = null, beat = null, wind = 8;
let clockOn = false, clockNext = 0, clockTock = false;
let slide = null, sat = null, speakerChain = null;
const satPrev = { d: null };

// ---------------------------------------------------------------- graph

function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  limiter = new DynamicsCompressorNode(ctx, { threshold: -4, knee: 2, ratio: 16, attack: 0.002, release: 0.2 });
  limiter.connect(ctx.destination);
  duckAll = new GainNode(ctx); duckAll.connect(limiter); // read-aloud pulls everything down 12 dB
  master = new GainNode(ctx, { gain: 0 }); master.connect(duckAll);
  for (const k of ["music", "ambience", "effects", "ui"]) { bus[k] = new GainNode(ctx); bus[k].connect(master); }
  // the score: smoke muffles it (lowpass); effects duck it 6 dB
  musicFilter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20000, Q: 0.5 });
  musicDuck = new GainNode(ctx);
  bus.music.disconnect(); bus.music.connect(musicFilter).connect(musicDuck).connect(master);
  // the outside: all around us outdoors, or through the window (muffled by the sash) once inside
  outIn = new GainNode(ctx);
  outLP = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20000, Q: 0.6 });
  outGain = new GainNode(ctx);
  outAround = new GainNode(ctx); outWindow = new GainNode(ctx, { gain: 0 });
  outIn.connect(outLP).connect(outGain);
  outGain.connect(outAround).connect(bus.ambience);
  for (const [k, p] of Object.entries(PLACES)) places[k] = panner(p, k === "clock" ? bus.ambience : bus.effects);
  outGain.connect(outWindow).connect(panner(PLACES.window, bus.ambience)); // the outside, from where the window is
  applyLevels();
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (on) ctx.resume();
  });
}

function panner([x, y, z], dest) {
  const p = new PannerNode(ctx, { panningModel: tier === "low" ? "equalpower" : "HRTF", distanceModel: "inverse", refDistance: 1.5, maxDistance: 40, rolloffFactor: 0.7,
    positionX: x, positionY: y, positionZ: z });
  p.connect(dest);
  return p;
}

function applyLevels() {
  if (!ctx) return;
  const t = ctx.currentTime;
  bus.music.gain.setTargetAtTime(settings.music * TRIM.music, t, 0.1);
  bus.ambience.gain.setTargetAtTime(settings.ambience * TRIM.ambience, t, 0.1);
  bus.effects.gain.setTargetAtTime(settings.effects * TRIM.effects, t, 0.1);
  bus.ui.gain.setTargetAtTime(settings.effects * TRIM.ui, t, 0.1);
}

const loadCues = () => (cuesP ||= fetch(BASE + "cues.json").then((r) => r.json()).then((j) => (cues = j.cues)).catch(() => (cues = {})));

function buffer(name) {
  if (!buffers.has(name)) {
    buffers.set(name, loadCues().then(() => {
      const c = cues[name];
      if (!c) throw new Error(`no cue ${name}`);
      return fetch(BASE + c.file).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
    }).catch(() => null));
  }
  return buffers.get(name);
}

// ---------------------------------------------------------------- beds

function setBed(name, target, tc = 0.6) {
  let b = beds[name];
  if (!b) {
    if (target < 0.002) return;
    b = beds[name] = { gain: new GainNode(ctx, { gain: 0 }), src: null, starting: false, quiet: 0 };
    b.gain.connect(OUTDOOR.includes(name) ? outIn : bus.ambience);
  }
  if (Math.abs(b.target - target) > 0.002 || b.target === undefined) { b.gain.gain.setTargetAtTime(target, ctx.currentTime, tc); b.target = target; }
  if (target >= 0.002 && !b.src && !b.starting) {
    b.starting = true;
    buffer(name).then((buf) => {
      b.starting = false;
      if (!buf || b.src || !(b.target >= 0.002)) return;
      const [a, z] = cues[name].loop;
      const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, loopStart: a, loopEnd: z });
      s.connect(b.gain);
      s.start(ctx.currentTime, a + Math.random() * (z - a)); // beds don't all start at their heads
      b.src = s;
    });
  }
}

/** stop beds that have been silent a while (cheap anyway, but a quiet graph is a cool laptop) */
function reapBeds(dt) {
  for (const b of Object.values(beds)) {
    if (!b.src) continue;
    b.quiet = b.target < 0.002 ? b.quiet + dt : 0;
    if (b.quiet > 6) { try { b.src.stop(); } catch { /* */ } b.src.disconnect(); b.src = null; b.quiet = 0; }
  }
}

// ---------------------------------------------------------------- music

function track(name) {
  if (tracks[name]) return tracks[name];
  const c = cues[name];
  if (!c) return null;
  const url = BASE + (tier === "low" && c.fileLow ? c.fileLow : c.file);
  const out = new GainNode(ctx, { gain: 0 }); out.connect(bus.music);
  const els = [0, 1].map(() => { const e = new Audio(); e.preload = "auto"; e.src = url; return e; });
  const gains = els.map((e, i) => { const g = new GainNode(ctx, { gain: i === 0 ? 1 : 0 }); ctx.createMediaElementSource(e).connect(g).connect(out); return g; });
  return (tracks[name] = { name, els, gains, out, active: 0, swapping: false, xfade: c.xfade || 6, stopTimer: 0 });
}

/** move the score to a track (or to silence), crossfading over `fade` seconds */
function musicTo(name, fade = 2.5) {
  if (name === current) return;
  const t = ctx.currentTime, prev = current && tracks[current];
  current = name;
  if (prev) {
    prev.out.gain.setTargetAtTime(0, t, fade / 3);
    clearTimeout(prev.stopTimer);
    prev.stopTimer = setTimeout(() => { if (current !== prev.name) prev.els.forEach((e) => e.pause()); }, fade * 1000 + 600);
  }
  if (!name) return;
  loadCues().then(() => {
    if (current !== name) return;
    const tr = track(name);
    if (!tr) return;
    clearTimeout(tr.stopTimer);
    const el = tr.els[tr.active];
    if (ONCE.has(name) && el.ended) el.currentTime = 0;
    el.play().catch(() => {});
    tr.out.gain.cancelScheduledValues(ctx.currentTime);
    tr.out.gain.setTargetAtTime(1, ctx.currentTime, fade / 3);
  });
}

/** loop seam: when the active element nears its end, start the other from the top and crossfade (equal power) */
function loopMusic() {
  const tr = current && tracks[current];
  if (!tr || tr.swapping || ONCE.has(tr.name)) return;
  const a = tr.els[tr.active];
  if (!a.duration || a.paused || a.currentTime < a.duration - tr.xfade) return;
  const i = 1 - tr.active, b = tr.els[i], x = tr.xfade, t = ctx.currentTime + 0.02, n = 64;
  tr.swapping = true;
  b.currentTime = 0;
  b.play().catch(() => {});
  const up = new Float32Array(n), down = new Float32Array(n);
  for (let k = 0; k < n; k++) { up[k] = Math.sin((k / (n - 1)) * Math.PI / 2); down[k] = Math.cos((k / (n - 1)) * Math.PI / 2); }
  tr.gains[i].gain.cancelScheduledValues(t); tr.gains[i].gain.setValueCurveAtTime(up, t, x);
  tr.gains[tr.active].gain.cancelScheduledValues(t); tr.gains[tr.active].gain.setValueCurveAtTime(down, t, x);
  const old = tr.active;
  tr.active = i;
  setTimeout(() => { tr.els[old].pause(); tr.swapping = false; }, x * 1000 + 300);
}

function duckMusic(db = -6, hold = 0.5) {
  const g = musicDuck.gain, t = ctx.currentTime;
  g.cancelScheduledValues(t); g.setTargetAtTime(dbToGain(db), t, 0.05); g.setTargetAtTime(1, t + hold, 0.6);
}

// ---------------------------------------------------------------- one-shots

/** play a cue once. opts: at (a place in the room), pan (-1..1), gain, rate, when (s from now), loop,
 *  to: a bus, or "outside" (heard all around outdoors, or through the window once inside) */
function cue(name, { at = null, pan = null, gain = 1, rate = 1, when = 0, to = "effects", loop = false } = {}) {
  if (!ctx || !on) return Promise.resolve(null);
  return buffer(name).then((buf) => {
    if (!buf) return null;
    const s = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate });
    if (loop && cues[name].loop) { s.loop = true; [s.loopStart, s.loopEnd] = cues[name].loop; }
    const g = new GainNode(ctx, { gain });
    let dest = at ? places[at] : to === "outside" ? outIn : bus[to], p = null;
    if (pan != null && !at) { p = new StereoPannerNode(ctx, { pan }); p.connect(dest); dest = p; }
    s.connect(g).connect(dest);
    s.start(ctx.currentTime + when, loop && cues[name].loop ? cues[name].loop[0] : 0);
    if (!loop) s.onended = () => { g.disconnect(); p?.disconnect(); };
    return { src: s, gain: g, pan: p, duration: buf.duration / rate };
  });
}

// ---------------------------------------------------------------- the room: clock, sash, listener

/** the wall clock ticks on the real second (it's the same clock the 3D second hand reads) */
function clock() {
  if (!clockOn) { clockNext = 0; return; }
  const now = Date.now();
  if (!clockNext || clockNext < now - 400) clockNext = Math.ceil(now / 1000) * 1000;
  while (clockNext - now < 160) {
    cue(clockTock ? "tock" : "tick", { at: "clock", gain: 0.7, when: Math.max(0, (clockNext - now) / 1000) });
    clockTock = !clockTock; clockNext += 1000;
  }
}

/** the sash's friction: a loop of the real sash recording, louder and higher the faster it moves */
function sashMove(speed) {
  if (!ctx || !on) return;
  if (!slide) {
    slide = { gain: new GainNode(ctx, { gain: 0 }), src: null };
    slide.gain.connect(places.sash);
    cue("sash-slide", { at: "sash", gain: 1, loop: true }).then((n) => {
      if (!n) return;
      n.gain.disconnect(); n.gain.connect(slide.gain); slide.src = n.src;
    });
  }
  const v = Math.abs(speed);
  glide(slide.gain.gain, clamp(v / 0.5) * 0.9, 0.04, 0.005);
  if (slide.src) glide(slide.src.playbackRate, 0.75 + clamp(v / 0.8) * 0.5, 0.05, 0.005);
}

const _v = [0, 0, 0];
function listen(camera) {
  if (!camera || !ctx) return;
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements, L = ctx.listener;
  if (L.positionX) {
    glide(L.positionX, e[12], 0.02); glide(L.positionY, e[13], 0.02); glide(L.positionZ, e[14], 0.02);
    glide(L.forwardX, -e[8], 0.02); glide(L.forwardY, -e[9], 0.02); glide(L.forwardZ, -e[10], 0.02);
    glide(L.upX, e[4], 0.02); glide(L.upY, e[5], 0.02); glide(L.upZ, e[6], 0.02);
  } else {
    L.setPosition(e[12], e[13], e[14]); L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
  }
}

// ---------------------------------------------------------------- the satellite (orbit chapter)

/** a soft telemetry hum, panned with the satellite on screen and bent by its speed toward us (Doppler) */
function satellite(level, obj, camera, dt) {
  if (!sat) {
    if (level < 0.01) return;
    const g = new GainNode(ctx, { gain: 0 }), pan = new StereoPannerNode(ctx), bp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 420, Q: 1.2 });
    const am = new GainNode(ctx, { gain: 0.6 }), lfo = new OscillatorNode(ctx, { frequency: 3.1 }), lfoAmt = new GainNode(ctx, { gain: 0.35 });
    lfo.connect(lfoAmt).connect(am.gain); lfo.start();
    const oscs = [196, 293.7, 587.3].map((f, i) => { const o = new OscillatorNode(ctx, { type: i === 2 ? "triangle" : "sine", frequency: f }); const og = new GainNode(ctx, { gain: [0.5, 0.35, 0.08][i] }); o.connect(og).connect(am); o.start(); return o; });
    am.connect(bp).connect(g).connect(pan).connect(bus.ambience);
    sat = { g, pan, oscs };
  }
  const t = ctx.currentTime;
  glide(sat.g.gain, level * 0.16, 0.3);
  if (!obj || !camera || level < 0.01) { satPrev.d = null; return; }
  obj.getWorldPosition(_tmp); const d = _tmp.distanceTo(camera.position);
  _tmp.project(camera); sat.pan.pan.setTargetAtTime(clamp(_tmp.x, -0.9, 0.9), t, 0.1);
  if (satPrev.d != null && dt > 0) {
    const closing = (satPrev.d - d) / dt / Math.max(0.5, d); // fraction of its distance per second
    const cents = clamp(closing * 300, -250, 250);
    sat.oscs.forEach((o) => o.detune.setTargetAtTime(cents, t, 0.15));
  }
  satPrev.d = d;
}
const _tmp = new THREE.Vector3();

// ---------------------------------------------------------------- outdoor events

/** a car passing outside, panned across as it goes */
function carPass(name, from, to, gain = 0.8) {
  cue(name, { to: "outside", pan: from, gain }).then((n) => {
    if (!n) return;
    const t = ctx.currentTime;
    n.pan.pan.setValueAtTime(from, t); n.pan.pan.linearRampToValueAtTime(to, t + n.duration * 0.85);
  });
}

const events = { cars: false, nextCar: 0, nextGeese: 0 };
/** the live window, now and then: cars (mostly at rush hour) and, in migration months, geese overhead */
function liveEvents(live, now) {
  const ms = now.getTime(), rush = /^(7|8|14|15)$/.test(String(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now)));
  if (!events.nextCar) { events.nextCar = ms + 8000 + Math.random() * 20000; events.nextGeese = ms + 60000 + Math.random() * 240000; }
  if (ms > events.nextCar) {
    const right = Math.random() < 0.5;
    carPass(Math.random() < 0.5 ? "car-a" : "car-b", right ? 0.8 : -0.8, right ? -0.8 : 0.8, 0.5 + Math.random() * 0.3);
    events.nextCar = ms + (rush ? 20000 + Math.random() * 40000 : 90000 + Math.random() * 180000);
  }
  if (ms > events.nextGeese) {
    const month = now.getMonth(), day = (live?.sunElevation ?? -10) > 2;
    if (day && [2, 3, 9, 10].includes(month)) cue("geese", { to: "outside", pan: Math.random() * 1.2 - 0.6, gain: 0.55 });
    events.nextGeese = ms + 240000 + Math.random() * 420000;
  }
}

// ---------------------------------------------------------------- the tape rewind (into the app)

let rw = null;
/** the motor: bandpassed noise (the tape hiss) and a buzzy motor tone, both rising with speed, with flutter;
 *  under it, if it's decoded, the last stretch of the score played backwards at the tape's speed */
function rewindStart() {
  if (!ctx || !on || rw) return;
  const t = ctx.currentTime, sr = ctx.sampleRate;
  const nb = ctx.createBuffer(1, sr * 2, sr), d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = new AudioBufferSourceNode(ctx, { buffer: nb, loop: true });
  const bp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 500, Q: 2.4 });
  const motor = new OscillatorNode(ctx, { type: "sawtooth", frequency: 55 });
  const mlp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 420, Q: 0.9 });
  const ng = new GainNode(ctx, { gain: 0.55 }), mg = new GainNode(ctx, { gain: 0.16 });
  const out = new GainNode(ctx, { gain: 0 }), am = new GainNode(ctx, { gain: 1 });
  const flutter = new OscillatorNode(ctx, { frequency: 9.5 }), fAmt = new GainNode(ctx, { gain: 0.18 });
  noise.connect(bp).connect(ng).connect(out); motor.connect(mlp).connect(mg).connect(out);
  flutter.connect(fAmt).connect(am.gain);
  out.connect(am).connect(bus.effects);
  noise.start(t); motor.start(t); flutter.start(t);
  rw = { noise, bp, motor, out, flutter, rev: null };
  // the score you just heard, backwards: the last 14 s before the playhead
  const tr = current && tracks[current];
  if (tier !== "low" && tr && (current === "dawn-end" || current === "dawn") && buffers.has(current)) {
    const pos = tr.els[tr.active].currentTime;
    buffers.get(current).then((buf) => {
      if (!buf || !rw) return;
      const a = Math.max(0, Math.floor((pos - 14) * buf.sampleRate)), b = Math.min(buf.length, Math.floor(pos * buf.sampleRate)), n = b - a;
      if (n < buf.sampleRate) return;
      const rev = ctx.createBuffer(buf.numberOfChannels, n, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) { const src = buf.getChannelData(c), dst = rev.getChannelData(c); for (let i = 0; i < n; i++) dst[i] = src[b - 1 - i]; }
      const s = new AudioBufferSourceNode(ctx, { buffer: rev, playbackRate: 1 });
      const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 220, Q: 0.7 }), g = new GainNode(ctx, { gain: 0 });
      s.connect(hp).connect(g).connect(am);
      s.start();
      rw.rev = { s, g };
    });
  }
  // the story steps aside: the score fades fast, the beds follow in applyMix(QUIET)
  musicTo(null, 0.45);
}
const QUIET = { beds: Object.fromEntries(BEDS.map((k) => [k, 0])), outsideGain: 0, outsideLowpass: 20000, inside: 0, clock: false, musicLowpass: 20000 };

// ---------------------------------------------------------------- per-frame drivers

function applyMix(mix, dt, { story = false } = {}) {
  for (const k of BEDS) setBed(k, mix.beds[k] || 0);
  glide(outLP.frequency, mix.outsideLowpass, 0.25, 0.01);
  glide(outGain.gain, mix.outsideGain, 0.25);
  glide(outAround.gain, 1 - mix.inside, 0.2);
  glide(outWindow.gain, mix.inside, 0.2);
  glide(musicFilter.frequency, story ? mix.musicLowpass : 20000, 0.3, 0.01);
  clockOn = mix.clock;
  clock();
  reapBeds(dt);
  loopMusic();
}

const blend = (a, b, f) => ({ ...a, beds: Object.fromEntries(BEDS.map((k) => [k, a.beds[k] + (b.beds[k] - a.beds[k]) * f])),
  outsideGain: a.outsideGain + (b.outsideGain - a.outsideGain) * f, outsideLowpass: a.outsideLowpass + (b.outsideLowpass - a.outsideLowpass) * f });

export const Sound = {
  get on() { return on; },
  get settings() { return { ...settings }; },
  /** turn sound on or off (a click must have happened first: browsers only start audio after one) */
  toggle(force) {
    on = force === undefined ? !on : !!force;
    if (on) { init(); loadCues(); ctx.resume(); }
    if (ctx) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 0.6 : 0.15);
    document.dispatchEvent(new CustomEvent("skywindow:sound", { detail: { on } }));
    return on;
  },
  setTier(t) { tier = t; },
  /** music / ambience / effects levels (0..1) and whether the live window keeps the music */
  set(levels) {
    Object.assign(settings, levels); saveSettings(); applyLevels();
    if ("liveMusic" in levels && ctx && lastT === null) musicTo(settings.liveMusic ? "dawn" : null, 2);
  },
  setWind(w) { if (w != null) wind = w; },

  /** the loader's Look outside: the bands part on a low air swell and Penumbra fades in */
  begin() { if (!on) return; cue("swell", { gain: 0.8 }); musicTo("penumbra", 4); },

  /** every story frame. opts: raise (sash, m), camera (the active world's), world, satellite (Object3D) */
  story(T, dt, { raise = 0, camera = null, world = null, satellite: satObj = null, live = null } = {}) {
    if (!ctx || !on) { lastT = T; return; }
    if (live?.wind != null) wind = live.wind;
    let mix = storyMix(T, { raise, wind, beat: T >= 7 && T < 8 ? beat : null });
    if (T >= 8) mix = blend(mix, liveMix({ live, raise }), clamp((T - 8) / 0.4)); // Right now: the real weather fades in
    musicTo(mix.music, mix.music === "dawn-end" ? 4 : 2.5);
    applyMix(mix, dt, { story: true });
    // the sash moving for each verdict (7-8) is heard; elsewhere the story's sash cues are one-shots
    const rv = lastRaise != null && dt > 0 ? (raise - lastRaise) / dt : 0;
    lastRaise = raise;
    if (slide || (T >= 6.95 && Math.abs(rv) > 0.02)) sashMove(T >= 6.95 && T < 8.6 ? rv : 0);
    listen(camera);
    satellite(world === "earth" ? mix.satellite : 0, satObj, camera, dt);
    // the street pose (3.5): two cars pass, once per visit
    if (T > 3.42 && T < 3.6 && !events.cars) { events.cars = true; carPass("car-a", -0.8, 0.8); setTimeout(() => carPass("car-b", 0.7, -0.7), 3800); }
    if (T < 3.2 || T > 3.9) events.cars = false;
    if (lastT !== null) {
      for (const m of crossings(lastT, T, dt, SHOT_MARKS)) {
        const [, name, at] = STORY_SHOTS.find((s) => s[0] === m);
        if (name === "whoosh") this.whoosh();
        else if (name === "sat-beep") cue("beep", { rate: 1.7, gain: 0.18, pan: sat ? sat.pan.pan.value : 0, to: "ambience" });
        else cue(name, { at: at && at !== "satellite" ? at : null, gain: name === "boom" ? 0.8 : 1 });
      }
    }
    lastT = T;
  },

  /** every live-window frame (and through the hand-off). opts: live (reading), raise, camera */
  live(dt, { live = null, raise = 0, camera = null } = {}) {
    if (!ctx || !on) return;
    lastT = null;
    musicTo(settings.liveMusic ? "dawn" : null, 2.2); // the music ends with the story
    applyMix(liveMix({ live, raise }), dt);
    listen(camera);
    if (live) liveEvents(live, new Date());
    satellite(0, null, null, dt);
  },

  /** every frame in the app: the live weather over PHS, outdoors (cars and geese now and then) */
  app(dt, { live = null } = {}) {
    if (!ctx || !on) return;
    lastT = null;
    if (live?.wind != null) wind = live.wind;
    musicTo(settings.liveMusic ? "dawn" : null, 2.2); // the music ends with the story, unless the mix panel keeps it
    applyMix(appMix({ live }), dt);
    if (live) liveEvents(live, new Date());
    satellite(0, null, null, dt);
  },
  cue,
  sashMove,
  /** decode the score's last phrase ahead of time, so the rewind can play it backwards */
  prepareRewind() { if (ctx && on && tier !== "low" && current) buffer(current); },
  /** the tape rewind begins: the story fades out under a motor whir */
  rewind() { rewindStart(); },
  /** every rewind frame: v is the tape's speed, 0..1 */
  rewindSpeed(v, dt = 0) {
    if (!ctx || !on) return;
    applyMix(QUIET, dt);
    if (!rw) return;
    const t = ctx.currentTime, k = clamp(v);
    rw.bp.frequency.setTargetAtTime(380 + 2600 * k, t, 0.04);
    rw.motor.frequency.setTargetAtTime(48 + 230 * k, t, 0.04);
    rw.out.gain.setTargetAtTime(0.06 + 0.3 * k, t, 0.05);
    if (rw.rev) { rw.rev.s.playbackRate.setTargetAtTime(0.7 + 4.2 * k, t, 0.05); rw.rev.g.gain.setTargetAtTime(0.5 * Math.min(1, k * 1.6), t, 0.05); }
  },
  /** the tape hits its stop: the motor cuts and the deck clunks (silent: just cut, for a skip) */
  rewindStop(silent = false) {
    if (rw) {
      const t = ctx.currentTime, r = rw; rw = null;
      r.out.gain.cancelScheduledValues(t); r.out.gain.setTargetAtTime(0, t, 0.012);
      if (r.rev) { r.rev.g.gain.cancelScheduledValues(t); r.rev.g.gain.setTargetAtTime(0, t, 0.012); }
      setTimeout(() => { [r.noise, r.motor, r.flutter, r.rev?.s].forEach((n) => { try { n?.stop(); } catch { /* */ } }); }, 300);
    }
    if (silent) return;
    cue("relay", { to: "ui", gain: 1 });
    cue("thud", { gain: 0.45 });
  },
  /** the hand-off's quiet moments: beds and the outside fade, nothing new starts */
  quiet(dt) { if (ctx && on) applyMix(QUIET, dt); },
  /** the sash hit a stop */
  sashStop(speed = 0.5) { cue("sash-thunk", { at: "sash", gain: clamp(Math.abs(speed) / 0.6, 0.25, 1) }); },
  /** the verdict changed on the device: its speaker beeps (twice for Ventilate) */
  verdict(key) {
    cue("beep", { at: "device", gain: 0.5 });
    if (key === "ventilate") cue("beep", { at: "device", gain: 0.5, when: 0.22 });
  },
  /** read-aloud: everything else down 12 dB while the device speaks */
  readAloud(speaking) { if (ctx) duckAll.gain.setTargetAtTime(speaking ? dbToGain(-12) : 1, ctx.currentTime, 0.12); },
  /** play an <audio> element (the spoken report) out of the device's small speaker */
  speaker(el) {
    init();
    ctx.resume();
    if (speakerChain) return;
    const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 320, Q: 0.8 }), lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 5200, Q: 0.7 });
    const p = panner(PLACES.device, limiter); // straight to the output: you asked for it, so it plays even with sound off
    ctx.createMediaElementSource(el).connect(hp).connect(lp).connect(p);
    speakerChain = { hp, lp, p };
  },

  /** what's playing (for the Sound Lab and tests) */
  _debug() {
    const r = (x) => Math.round(x * 1000) / 1000;
    return {
      ctx: ctx?.state ?? "none", on, current,
      tracks: Object.fromEntries(Object.entries(tracks).map(([k, t]) => [k, { at: r(t.els[t.active].currentTime), playing: !t.els[t.active].paused, gain: r(t.out.gain.value) }])),
      beds: Object.fromEntries(Object.entries(beds).filter(([, b]) => b.src || b.target > 0).map(([k, b]) => [k, { target: r(b.target), gain: r(b.gain.gain.value), running: !!b.src }])),
      outside: ctx ? { gain: r(outGain.gain.value), lowpass: Math.round(outLP.frequency.value), window: r(outWindow.gain.value) } : null,
      musicLowpass: ctx ? Math.round(musicFilter.frequency.value) : null, clock: clockOn, satellite: sat ? r(sat.g.gain.value) : 0,
    };
  },

  // the old API
  whoosh() { if (!ctx || !on) return; cue("whoosh", { gain: 0.9 }); cue("whoosh-light", { gain: 0.6, when: 0.18 }); duckMusic(-6, 0.8); },
  /** a quiet wooden tick: snap points, the ruler's detents */
  tick() { cue("tock", { to: "ui", gain: 0.45, rate: 1.15 }); },
  /** the story's verdict beats (T 7-8): the device beeps and the beat sets the mix (shut brings the smoke back) */
  chime(key) { beat = key; this.verdict(key); },
};

addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "m" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
  Sound.toggle();
});
