// Dynamic resolution: keeps each world near 60 fps on whatever display and GPU it runs on.
// When frames keep missing vsync it steps quality down (ambient occlusion to half resolution, then the
// pixel ratio in 0.25 steps); after a world has run cleanly for a while it tries one step back up, and if
// that misses again it stays down. Remembered per world: the classroom (the heaviest scene) can drop
// without costing the Earth or Princeton any sharpness. Steps land on world changes, which happen under
// the cloud curtains, or straight away when a world is already struggling.

const SLOW_MS = 21; // median frame time that means "missing 60 fps" (a 120 Hz display at 60 is fine)
const CLEAN_MS = 17.6; // median at or under this is a clean 60
const WINDOW = 45; // frames per judgement
const SETTLE_S = 1.5; // after a change, let render targets reallocate before judging again
const PROBE_AFTER_S = 8; // clean seconds before trying a step back up
const PROBE_S = 2.5; // how long a step up has to prove itself

export function createGovernor({ stage, tier, onChange = () => {} }) {
  const maxPR = stage.renderer.getPixelRatio();
  const minPR = tier === "low" ? Math.min(maxPR, 0.75) : Math.min(maxPR, 1);
  // quality ladder, best first: [pixel ratio, ambient occlusion scale]
  const ladder = [[maxPR, 1]];
  if (tier === "high") ladder.push([maxPR, 0.5]);
  for (let pr = maxPR - 0.25; pr > minPR - 0.01; pr -= 0.25) ladder.push([Math.max(minPR, +pr.toFixed(2)), tier === "high" ? 0.5 : 1]);

  const worlds = {}; // key -> { level, ceiling }
  let active = null, frames = [], settle = 0, clean = 0, probe = null, applied = null;

  const st = (k) => (worlds[k] ||= { level: 0, ceiling: 0 });
  function apply(k) {
    const [pr, ao] = ladder[st(k).level];
    const key = pr + ":" + ao;
    if (key === applied) return;
    applied = key;
    stage.setQuality({ pixelRatio: pr, ao });
    settle = SETTLE_S; frames = [];
    onChange({ world: k, level: st(k).level, pixelRatio: pr, ao });
  }
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

  return {
    get state() { return { active, worlds: JSON.parse(JSON.stringify(worlds)), ladder } },
    /** every frame: how long the last one took (ms) and which world is on screen. busy: a hand-off or load, don't judge */
    frame(dtMs, world, { busy = false } = {}) {
      if (world !== active) { active = world; probe = null; clean = 0; apply(world); }
      if (busy || document.hidden || dtMs > 250) return; // hitches (compiles, tab switches) aren't the scene's fault
      if (settle > 0) { settle -= dtMs / 1000; return; }
      frames.push(dtMs);
      if (frames.length < WINDOW) return;
      const m = median(frames), s = st(world), secs = frames.reduce((a, b) => a + b, 0) / 1000;
      frames = [];
      if (m > SLOW_MS) {
        clean = 0;
        if (probe) { s.ceiling = probe.from; s.level = probe.from; probe = null; apply(world); return; } // the step up didn't hold
        if (s.level < ladder.length - 1) { s.level++; apply(world); }
        return;
      }
      if (probe) { probe.left -= secs; if (probe.left <= 0) probe = null; return; }
      if (m <= CLEAN_MS && s.level > s.ceiling) {
        clean += secs;
        if (clean >= PROBE_AFTER_S) { clean = 0; probe = { from: s.level, left: PROBE_S }; s.level--; apply(world); }
      } else clean = 0;
    },
  };
}
