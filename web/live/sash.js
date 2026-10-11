// Lift the sash: grab it in 3D (or focus the slider and use the arrow keys) to see what opening the
// window would do. It moves on a spring, holds where you leave it for 20 s, then settles back to
// what SkyWindow recommends.
import * as THREE from "three";
import { airflow, minutesToFresh, projectIndex, indoorPM } from "../model/ventilation.js";

const HOLD_MS = 20000;
const MAX = 0.78;

export function createSash({ stage, room, spring, ui, sound, recommended, getData }) {
  const canvas = stage.renderer.domElement;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const input = document.getElementById("sash-input");
  let dragging = null, holding = false, holdTimer = 0, hover = false, lastDetent = -1, lastValue = null, lastVel = 0;
  const active = () => document.documentElement.dataset.mode === "live";

  function hit(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, room.camera);
    return ray.intersectObject(room.win.lowerSash, true).length > 0;
  }

  /** screen pixels per metre of sash travel at the current camera */
  function pxPerMetre() {
    const a = new THREE.Vector3(0, 1.0 + spring.value, -0.015).project(room.camera);
    const b = new THREE.Vector3(0, 1.1 + spring.value, -0.015).project(room.camera);
    return Math.max(40, Math.abs(b.y - a.y) * 0.5 * innerHeight * 10);
  }

  function hold() {
    holding = true; holdTimer = performance.now() + HOLD_MS;
    ui.setWhatIf(whatIf(spring.target), true);
  }
  function settle() {
    holding = false;
    spring.set(recommended());
    ui.setWhatIf(null, false);
    syncInput();
  }

  function setRaise(r, { fromKeys = false } = {}) {
    const v = Math.max(0, Math.min(MAX, r));
    spring.set(v);
    if (fromKeys) hold();
    ui.setWhatIf(whatIf(v), true);
    syncInput(v);
  }
  function syncInput(v = spring.target) {
    if (!input) return;
    const cm = Math.round(v * 100);
    input.value = String(cm);
    input.setAttribute("aria-valuetext", cm === 0 ? "Shut" : `Open ${cm} cm`);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!active() || e.button !== 0 || !hit(e)) return;
    dragging = { y: e.clientY, r: spring.target, ppm: pxPerMetre(), id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("dragging-sash");
    holding = true; holdTimer = Infinity;
    sound.tick?.();
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!active()) return;
    if (dragging && e.pointerId === dragging.id) { setRaise(dragging.r + (dragging.y - e.clientY) / dragging.ppm); return; }
    if (e.pointerType === "mouse") {
      const h = hit(e);
      if (h !== hover) { hover = h; document.documentElement.classList.toggle("over-sash", h); }
    }
  });
  const end = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    dragging = null;
    document.documentElement.classList.remove("dragging-sash");
    hold();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  input?.addEventListener("input", () => setRaise(+input.value / 100, { fromKeys: true }));
  document.addEventListener("skywindow:sash-reset", settle);

  /** what the what-if line says for an opening of r metres */
  function whatIf(r) {
    const l = getData()?.live;
    if (!l) return null;
    const a = airflow({ raise: r, windKmh: l.wind ?? 0, tOutC: l.temp });
    const idx0 = l.stale ?? 20;
    const smoky = (l.pm25 ?? 0) > 35.4 || (l.aod ?? 0) > 0.7 || l.outdoorLevel === "bad";
    return {
      raise: r, ach: a.ach, smoky, idx0,
      minutes: minutesToFresh({ idx0, ach: a.ach }),
      pmIn: smoky ? indoorPM({ cOut: l.pm25 ?? 0, ach: a.ach, minutes: 60 }) : null,
      pmShut: smoky ? indoorPM({ cOut: l.pm25 ?? 0, ach: 0, minutes: 60 }) : null,
      // the room's stale index over the next 6 hours with the sash left here (for the chart)
      projection: Array.from({ length: 13 }, (_, i) => projectIndex({ idx0, ach: a.ach, minutes: i * 30 })),
    };
  }

  return {
    get holding() { return holding; },
    get dragging() { return !!dragging; },
    whatIf, settle, setRaise,
    update(dt) {
      if (holding && !dragging && performance.now() > holdTimer) settle();
      // its sound: wood sliding in the frame at the speed it moves, a thunk when it reaches a stop
      const x = spring.value, vel = spring.velocity;
      if (active()) sound.sashMove?.(vel);
      if (lastValue != null) {
        const hitBottom = lastValue > 0.004 && x <= 0.004 && lastVel < -0.12, hitTop = lastValue < MAX - 0.004 && x >= MAX - 0.004 && lastVel > 0.12;
        if (active() && (hitBottom || hitTop)) sound.sashStop?.(lastVel);
      }
      lastValue = x; lastVel = vel;
      // a soft detent click every 10 cm while the sash moves
      const d = Math.floor(spring.value * 10 + 0.5);
      if (d !== lastDetent) { if (lastDetent >= 0 && (dragging || holding)) sound.tick?.(); lastDetent = d; }
      void dt;
    },
  };
}
