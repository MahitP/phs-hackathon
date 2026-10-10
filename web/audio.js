// Generative ambience: filtered noise that sounds like wind (louder and brighter with real wind
// speed, gustier and darker with smoke haze) over a low "high-altitude" drone. No audio files.
const SkyAudio = (() => {
  let ctx, noiseGain, filter, drone, droneGain, master, on = false, wind = 8, haze = 0, gustTimer;

  function start() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);

    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; } // brown-ish noise
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    filter = ctx.createBiquadFilter(); filter.type = "bandpass"; filter.Q.value = 0.8;
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0.2;
    src.connect(filter).connect(noiseGain).connect(master);
    src.start();

    drone = ctx.createOscillator(); drone.type = "sine"; drone.frequency.value = 55;
    const drone2 = ctx.createOscillator(); drone2.type = "sine"; drone2.frequency.value = 82.4;
    droneGain = ctx.createGain(); droneGain.gain.value = 0.05;
    drone.connect(droneGain); drone2.connect(droneGain); droneGain.connect(master);
    drone.start(); drone2.start();
    apply();
    gust();
  }

  function gust() {
    if (!ctx) return;
    const now = ctx.currentTime, strength = 0.15 + Math.min(1, wind / 30) * 0.5 + haze * 0.15;
    noiseGain.gain.cancelScheduledValues(now);
    noiseGain.gain.setTargetAtTime(strength * (0.5 + Math.random() * 0.8), now, 0.8);
    filter.frequency.setTargetAtTime((350 + wind * 25) * (1 - haze * 0.45) * (0.7 + Math.random() * 0.6), now, 1.2);
    gustTimer = setTimeout(gust, 1200 + Math.random() * 2200);
  }

  function apply() {
    if (!ctx) return;
    master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.6);
    drone.frequency.setTargetAtTime(55 - haze * 8, ctx.currentTime, 2);
  }

  function toggle(force) {
    on = force === undefined ? !on : force;
    if (on) start();
    if (ctx && ctx.state === "suspended") ctx.resume();
    apply();
    return on;
  }

  function setSky({ wind: w = 8, haze: h = 0 }) { wind = w || 0; haze = h; apply(); }

  return { toggle, setSky, get on() { return on; } };
})();
