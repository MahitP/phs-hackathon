// The live window: the classroom from the story, showing the real sky over PHS right now.
// The 3D window is the main display; the interface sits on the wall beside it, ruled by the window's
// own horizontal members (head rail, meeting rail, sill) extended across the wall.
import * as THREE from "three";
import { createSpring } from "../shell/spring.js";
import { RAISE, verdictKey } from "../shell/copy.js";
import { END_T } from "../story/mode.js";
import { createLiveUI } from "./ui.js";
import { createSash } from "./sash.js";
import { livePose, liveShift, clonePose } from "./pose.js";
import { viewport } from "../shell/viewport.js";

const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
// the window's horizontal members in room coordinates (story/models/sash.js): head, meeting rail, sill
const RULES = { head: 2.72, meet: 1.82, sill: 0.92 };
const FRAME_X = 0.7; // outer edge of the window casing (opening ±0.6)

export function createLiveMode({ store, sound, reduced, router }) {
  const root = document.documentElement;
  const ui = createLiveUI({ store, sound, router, reduced });
  let stage = null, room = null, hud = null, data = null, queued = null;
  const sashSpring = createSpring({ value: 0, stiffness: 60, damping: 15 });
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const drive = { camera: null, raise: 0, near: 0.03, snap: false };
  let snapNext = false;
  let base = null, shift = { x: 0, y: 0 }, sash = null;
  const scratch = new THREE.PerspectiveCamera();
  const v = new THREE.Vector3();

  addEventListener("pointermove", (e) => { mouse.x = e.clientX / viewport.w * 2 - 1; mouse.y = e.clientY / viewport.h * 2 - 1; });

  const recommended = () => RAISE[verdictKey(data?.live?.verdict)] ?? 0;

  /** Where the window's rails land on screen at the live pose: the interface's rules line up with them. */
  function placeRules() {
    if (!room) return;
    scratch.copy(room.camera);
    scratch.position.fromArray(base.p); scratch.fov = base.fov; scratch.aspect = viewport.w / viewport.h;
    scratch.lookAt(v.fromArray(base.t));
    if (shift.x || shift.y) scratch.setViewOffset(viewport.w, viewport.h, -shift.x, -shift.y, viewport.w, viewport.h); else scratch.clearViewOffset();
    scratch.updateProjectionMatrix(); scratch.updateMatrixWorld();
    // the camera looks toward +z, so the frame's screen-left edge is the casing at +x
    const px = (y, x = FRAME_X) => { v.set(x, y, -0.02).project(scratch); return [(v.x * 0.5 + 0.5) * viewport.w, (-v.y * 0.5 + 0.5) * viewport.h]; };
    const [hx, hy] = px(RULES.head), [, my] = px(RULES.meet), [sx, sy] = px(RULES.sill);
    // the head rail can sit above the picture: then the column's top rule sits just under the header
    const top = parseFloat(getComputedStyle(root).getPropertyValue("--lv-head")) + 28;
    const s = root.style;
    s.setProperty("--rule-head", Math.max(top, hy).toFixed(1) + "px");
    s.setProperty("--rule-meet", my.toFixed(1) + "px");
    s.setProperty("--rule-sill", sy.toFixed(1) + "px");
    s.setProperty("--frame-left", Math.min(hx, sx).toFixed(1) + "px");
  }

  /** The wall wash ends at the window frame wherever the camera has put it (it moves during the hand-off). */
  let lastEdge = -1;
  const wash = document.getElementById("lv-wash");
  function washEdge() {
    const c = room.camera; c.updateMatrixWorld();
    const sx = (y) => (v.set(FRAME_X, y, -0.02).project(c).x * 0.5 + 0.5) * viewport.w;
    const e = Math.min(sx(RULES.head), sx(RULES.sill));
    if (Math.abs(e - lastEdge) > 0.5) { lastEdge = e; wash.style.setProperty("--wash-edge", e.toFixed(1) + "px"); }
  }

  /** Measure for this screen: the resting pose, the lens shift, the rules. Applies the shift only when asked. */
  function layout({ apply = root.dataset.mode === "live" && !root.dataset.handoff } = {}) {
    shift = liveShift(viewport.w, viewport.h);
    base = clonePose(livePose(viewport.w, viewport.h));
    root.dataset.liveShape = viewport.w / viewport.h < 1.1 ? "tall" : "wide";
    placeRules();
    if (apply && stage) stage.setShift(shift.x, shift.y);
  }

  const mode = {
    ui,
    /** readable text before any 3D (cold start in app.html, or no WebGL) */
    showStatic() { ui.setAssembled(true); ui.setActive(true); },
    setData(s) {
      data = s;
      if (root.dataset.handoff) { queued = s; return; } // nothing changes under a moving camera
      ui.render(s);
      if (!sash?.holding) sashSpring.set(recommended());
    },
    flush() { if (queued) { const q = queued; queued = null; mode.setData(q); } },
    attach(ctx) {
      ({ stage, room, hud } = ctx);
      layout();
      stage.onResize(() => layout());
      sash = createSash({ stage, room, spring: sashSpring, ui, sound, recommended, getData: () => data });
      ui.attach({ stage, room, sash });
      if (data) ui.render(data);
    },
    /** arriving at app.html directly: the room fades in behind text that is already there */
    enterCold() {
      layout({ apply: true });
      snapNext = true;
      sashSpring.jump(recommended());
      ui.setAssembled(true);
      ui.setActive(true);
      ui.leaders?.setDrawn(1);
    },
    reveal() { root.dataset.liveReady = "true"; },
    get restPose() { if (!base) layout({ apply: false }); return base; },
    get shiftTarget() { return shift; },
    layout,
    pose: { p: [0, 0, 0], t: [0, 0, 0], fov: 38 },
    get sashSpring() { return sashSpring; },
    /** the latest store snapshot (sound reads the weather from it) */
    get data() { return data; },
    /** the sash to where SkyWindow recommends (unless someone is holding it); no spring under reduced motion */
    /** leaving the live window: a what-if in progress ends, and the sash returns to the recommendation */
    cancelWhatIf() { if (sash?.holding) sash.settle(); },
    settleSash() { if (sash?.holding) return; reduced ? sashSpring.jump(recommended()) : sashSpring.set(recommended()); },
    /** the next frame jumps the room's sky to the live one instead of drifting there */
    snapSky() { snapNext = true; },
    frame(dt, time, poseOverride = null, parallax = 1) {
      const w = stage.setActiveWorld("room");
      mouse.sx = damp(mouse.sx, reduced ? 0 : mouse.x, 2.5, dt);
      mouse.sy = damp(mouse.sy, reduced ? 0 : mouse.y, 2.5, dt);
      const src = poseOverride || base, p = mode.pose;
      p.p[0] = src.p[0] + mouse.sx * 0.05 * parallax; p.p[1] = src.p[1] - mouse.sy * 0.03 * parallax; p.p[2] = src.p[2];
      p.t[0] = src.t[0]; p.t[1] = src.t[1]; p.t[2] = src.t[2]; p.fov = src.fov;
      drive.camera = p;
      drive.snap = snapNext; snapNext = false;
      drive.raise = sashSpring.update(dt);
      sash?.update(dt, time);
      w.update(END_T, dt, time, hud, data?.live || null, sound, drive);
      washEdge();
      stage.post.tickWorld(END_T);
      stage.post.setCurtain(0, null, time);
      stage.post.tick(time);
    },
    afterRender(dt, time) { ui.afterRender(dt, time); },
  };
  return mode;
}
