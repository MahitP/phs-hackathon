// Generated sound, no audio files: a wind bed that follows the live wind, a low drone, a whoosh for
// each scene change, a soft tick on hero poses and a chime per verdict. Off until the visitor turns it on.
let ctx = null, master, noiseGain, noiseFilter, droneGain, on = false, wind = 8;

function noiseBuffer(seconds = 3) {
  const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
  return buf;
}

function start() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
  noiseFilter = ctx.createBiquadFilter(); noiseFilter.type = "bandpass"; noiseFilter.Q.value = 0.7;
  noiseGain = ctx.createGain(); noiseGain.gain.value = 0.16;
  src.connect(noiseFilter).connect(noiseGain).connect(master); src.start();
  droneGain = ctx.createGain(); droneGain.gain.value = 0.045; droneGain.connect(master);
  [55, 82.4, 110.2].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = [1, 0.6, 0.25][i]; o.connect(g).connect(droneGain); o.start();
  });
  gust();
}

function gust() {
  if (!ctx) return;
  const t = ctx.currentTime, s = 0.12 + Math.min(1, wind / 30) * 0.45;
  noiseGain.gain.setTargetAtTime(s * (0.55 + Math.random() * 0.7), t, 0.9);
  noiseFilter.frequency.setTargetAtTime((320 + wind * 24) * (0.7 + Math.random() * 0.6), t, 1.3);
  setTimeout(gust, 1300 + Math.random() * 2200);
}

export const Sound = {
  get on() { return on; },
  toggle(force) {
    on = force === undefined ? !on : force;
    if (on) start();
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.5); }
    return on;
  },
  setWind(w) { if (w != null) wind = w; },
  whoosh(dur = 1.6) {
    if (!on || !ctx) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur + 0.2);
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.6); f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + dur + 0.2);
  },
  tick() {
    if (!on || !ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(1320, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.08);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.14);
  },
  chime(key) {
    if (!on || !ctx) return;
    const root = { open: 523.25, either: 440, shut: 293.66, ventilate: 587.33 }[key] || 440;
    const t = ctx.currentTime;
    [1, 1.5, 2].forEach((m, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = root * m * (key === "shut" ? (i === 1 ? 1.2 / 1.5 : 1) : 1);
      g.gain.setValueAtTime(0.0001, t + i * 0.06); g.gain.exponentialRampToValueAtTime(0.16 / (i + 1), t + i * 0.06 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(master); o.start(t + i * 0.06); o.stop(t + 1.7);
    });
  },
};
