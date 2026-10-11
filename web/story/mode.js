// The scroll story as a mode of the shell: scroll → story time T → which world, its update, the
// cloud curtains between worlds, and the chapter text. The renderer and the loop belong to the shell.
import { range, clamp, formatTime } from "./util.js";
import { LABEL, WHY, STRETCH, verdictKey } from "../shell/copy.js";

// hero poses the scroll settles onto (story time)
export const SNAPS = [0.56, 3.5, 4.78, 6.1, 6.3, 6.5, 6.7, 6.88, 7.15, 7.38, 7.61, 7.86, 8.5];
// hand-offs between the three worlds: [start, end, swap point, cloud colour]
export const CURTAINS = [[2.25, 2.95, 2.656, "#8d97a4"], [4.86, 5.36, 5.15, "#e9edf0"]];
export const END_T = 8.5;
export const worldAt = (T) => (T < CURTAINS[0][2] ? "earth" : T < CURTAINS[1][2] ? "princeton" : "room");
// with reduced motion the camera holds one pose per chapter instead of flying between them
const REDUCED_POSE = [0.56, 1.6, 2.8, 3.5, 4.75, 5.95, 6.1, 7.15, 8.5];

export function createStoryMode({ stage, scroll, hud, sound, reduced }) {
  let live = null, T = 0, sceneT = 0;

  /** opts.T plays the story at that time instead of the scroll's (the rewind); opts.quiet keeps the
   *  chapter text where it is and the worlds' one-shot sounds off */
  function frame(dt, time, { T: at = null, quiet = false } = {}) {
    if (at == null) { scroll.update(dt); T = scroll.T; } else T = at;
    if (!Number.isFinite(T)) T = 0;
    // the scene holds a pose per chapter under reduced motion, but the text follows the real scroll
    sceneT = reduced ? REDUCED_POSE[clamp(Math.floor(T), 0, REDUCED_POSE.length - 1)] : T;
    // (after a cold start in the live window the earlier worlds may still be streaming in)
    const want = worldAt(sceneT), key = stage.worlds[want] ? want : "room", w = stage.setActiveWorld(key);
    w.update(sceneT, dt, time, hud, live, quiet ? null : sound);
    stage.post.tickWorld(sceneT);

    let cover = 0, color = null;
    // (the whoosh under each cloud is on the sound engine's cue sheet: forward only, never when flung through)
    for (const [a, b, , c] of CURTAINS) if (sceneT > a && sceneT < b) { cover = range(sceneT, a, b); color = c; }
    stage.post.setCurtain(cover, color, time);
    stage.post.tick(time);
    if (!quiet) hud.update(T);
    if (sceneT < 7 || sceneT >= 8) hud.verdict(null);
    return key;
  }

  function setLive(l) { if (l) live = l; showLive(l, hud); }

  return { frame, setLive, get T() { return T; }, get sceneT() { return sceneT; }, get live() { return live; } };
}

/** The "Right now" chapter's text. */
export function showLive(l, hud) {
  if (!l) { hud.set("phs-live", "Live data unavailable right now."); hud.set("now-note", "Live data is unavailable right now. Open the live window to retry."); return; }
  const aqi = l.aqi != null ? Math.round(l.aqi) : null, wind = l.wind != null ? Math.round(l.wind) : null;
  const when = formatTime(new Date(l.at));
  const windTxt = wind != null ? `wind ${wind} km/h${l.windFrom ? " from the " + l.windFrom : ""}` : "";
  hud.set("phs-live", `Right now: AQI ${aqi ?? "?"}${windTxt ? ", " + windTxt : ""}.`);
  hud.set("live-aqi", aqi != null ? String(aqi) : "?");
  hud.set("live-wind", windTxt ? windTxt.charAt(0).toUpperCase() + windTxt.slice(1) : "");
  hud.set("live-aod", l.aod != null ? l.aod.toFixed(2) : "?");
  const v = verdictKey(l.verdict);
  const word = document.getElementById("now-verdict");
  if (word) { word.textContent = LABEL[v]; word.dataset.v = v; word.style.fontStretch = STRETCH[v] + "%"; }
  hud.set("now-why", WHY[v]);
  const roomTxt = l.stale != null ? `, room ${Math.round(l.stale)} of 100${l.mode !== "device" || l.mock ? " (simulated)" : ""}` : "";
  const src = l.mode === "device" ? (l.mock ? "from the Pi server, with simulated sensors" : "from the Raspberry Pi at PHS") : l.mode === "cached" ? "last saved reading" : "live sky, simulated room";
  hud.set("now-note", `AQI ${aqi ?? "?"} outside${roomTxt}. ${src.charAt(0).toUpperCase() + src.slice(1)}, ${when}.`);
}
