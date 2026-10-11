// Callouts in the drafting style: a dot on the real part in 3D, a hairline out to the clear wall
// right of the window, and two short lines of text. Re-projected every frame, so they stay pinned
// while the camera moves. L toggles them.
import * as THREE from "three";
import { compass } from "../model/geo.js";
import { viewport } from "../shell/viewport.js";

const DIRS = { N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" };

export function createLeaders({ room, svg, reduced }) {
  const layer = document.getElementById("live");
  const v = new THREE.Vector3(), edge = new THREE.Vector3();
  const anchors = {
    glass: { world: () => v.set(0.32, 2.2, 0.03) },
    sash: { world: () => v.set(0, room.win.lowerSash.position.y + 0.035, -0.045) }, // the lift handle
    air: { world: () => room.device.parts.air.getWorldPosition(v) },
  };
  const items = Object.keys(anchors).map((k) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "3.5"); g.append(line, dot); svg.appendChild(g);
    const label = document.createElement("div"); label.className = "lv-callout"; label.dataset.k = k;
    const a = document.createElement("b"), b = document.createElement("span"); label.append(a, b); layer.appendChild(label);
    return { k, g, line, dot, label, a, b, len: 0, y: 0 };
  });
  let on = true, drawn = reduced ? 1 : 0, drawTarget = 1, sashCm = null, data = null;

  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "l" || e.metaKey || e.ctrlKey || e.altKey || document.documentElement.dataset.mode !== "live") return;
    if (/input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
    on = !on; document.documentElement.classList.toggle("no-callouts", !on);
  });

  function project(vec) {
    vec.project(room.camera);
    return [(vec.x * 0.5 + 0.5) * viewport.w, (-vec.y * 0.5 + 0.5) * viewport.h, vec.z < 1];
  }

  function texts() {
    const l = data?.live;
    const t = {};
    if (l) {
      const day = (l.sunElevation ?? 0) >= 3, dir = DIRS[compass(l.sunAzimuth)] || "";
      const sky = l.cloud == null ? "Sky" : l.cloud > 80 ? "Overcast" : l.cloud > 40 ? "Partly cloudy" : day ? "Clear" : "Clear night";
      t.glass = [day ? `${sky}, sun ${Math.round(l.sunElevation)}° up in the ${dir}` : `${sky}, sun below the horizon`,
        l.transmission != null ? `${l.transmission}% of direct sunlight gets through the haze` : `Haze ${l.aod != null ? l.aod.toFixed(2) : "?"} AOD over PHS`];
      t.air = l.mode === "device" && !l.mock && l.air != null ? [`Air sensor ${Math.round(l.air)}`, `clean baseline ${l.baseline != null ? Math.round(l.baseline) : "learning"}`]
        : ["Air sensor", "simulated: no Pi connected"];
    } else { t.glass = ["Sky", "waiting for data"]; t.air = ["Air sensor", "waiting for data"]; }
    const cm = sashCm ?? Math.round(room.win.raise * 100);
    t.sash = [cm <= 0 ? "Sash shut" : `Sash open ${cm} cm`, sashCm != null ? "what if: drag it, or use the arrow keys" : "drag it to see what opening does"];
    return t;
  }

  return {
    setData(l, s) { data = { live: l, s }; },
    setSash(cm) { sashCm = cm; },
    /** 0..1: how much of each leader is drawn (the hand-off draws them in) */
    setDrawn(x) { drawn = x; drawTarget = x; },
    animateIn(duration = 0.8) { drawn = 0; drawTarget = 1; this._speed = 1 / duration; },
    _speed: 1.25,
    update(dt) {
      if (drawn < drawTarget) drawn = Math.min(drawTarget, drawn + dt * this._speed);
      const tx = texts();
      // labels hang just inside the frame's screen-left edge (+x: the camera looks toward +z), clear of the column
      const [fx] = project(edge.set(0.7, 1.6, 0));
      const colX = Math.min(viewport.w - 230, fx + 40);
      const used = [];
      for (const it of items) {
        const [x, y, vis] = project(anchors[it.k].world());
        let ly = y;
        for (const u of used) if (Math.abs(ly - u) < 54) ly = u + 54;
        used.push(ly);
        const show = on && vis && viewport.w / viewport.h > 1.1;
        it.g.style.display = it.label.style.display = show ? "" : "none";
        if (!show) continue;
        const ex = colX - 8, mx = x + (ex - x) * 0.4;
        const d = `M${x.toFixed(1)} ${y.toFixed(1)}L${mx.toFixed(1)} ${ly.toFixed(1)}L${ex.toFixed(1)} ${ly.toFixed(1)}`;
        // (measured by hand: getTotalLength() would force a style and layout pass every frame)
        if (it.d !== d) { it.line.setAttribute("d", d); it.d = d; it.len = Math.hypot(mx - x, ly - y) + Math.abs(ex - mx); }
        it.line.style.strokeDasharray = `${it.len}`;
        it.line.style.strokeDashoffset = `${(1 - drawn) * it.len}`;
        it.dot.setAttribute("cx", x.toFixed(1)); it.dot.setAttribute("cy", y.toFixed(1));
        it.dot.style.opacity = String(Math.min(1, drawn * 3));
        it.label.style.transform = `translate(${colX.toFixed(1)}px, ${(ly - 11).toFixed(1)}px)`;
        it.label.style.clipPath = `inset(0 ${((1 - Math.max(0, (drawn - 0.5) * 2)) * 100).toFixed(1)}% 0 0)`;
        const [a, b] = tx[it.k];
        if (it.a.textContent !== a) it.a.textContent = a;
        if (it.b.textContent !== b) it.b.textContent = b;
      }
    },
  };
}
