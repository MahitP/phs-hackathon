// The SkyWindow hardware, modelled in code at real size: Raspberry Pi 4 Model B, Seeed Grove Base HAT,
// Grove Air Quality Sensor v1.3, Grove Light Sensor v1.2, Grove 16x2 LCD RGB Backlight, a small speaker and
// Grove cables. Pi component positions follow the official Raspberry Pi 4 mechanical drawing; the HAT and the
// Grove modules follow Seeed's product photos. Everything is built in millimetres inside groups scaled by
// 0.001, so the scene stays in metres. Each part is its own group so the story can explode the view.
//
// API: createDevice({ tier }) → { root, parts, setLCD(line1, line2, [r, g, b]), setExplode(0..1), anchor(name),
//      speaker, tick(time) }
//   tick(time) (seconds) blinks the Pi's green ACT LED. Optional: setLCD() also drives the LED from the clock,
//   so it blinks even if tick is never called.
import * as THREE from "three";
import * as P from "./pcb.js";

const S = 0.001; // millimetres → metres
const PI_TOP = 7.4, HAT_TOP = 20.0; // Pi on 6 mm standoffs (1.4 mm board); HAT on 11 mm standoffs (1.6 mm board)
const px = (X) => X - 42.5, pz = (Y) => 28 - Y; // Pi / HAT board space (mechanical drawing) → local mm
const bp = (X0, X1, Y0, Y1, Z0, Z1, base = PI_TOP) => P.box(px(X0), base + Z0, pz(Y1), px(X1), base + Z1, pz(Y0));

const C = {
  black: 0x161616, header: 0x111111, cavity: 0x1b1b1b, usb3: 0x1b56d0, latch: 0x8e5b2c, cream: 0xeee1c3,
  white: 0xf2f1ec, plug: 0xf0eee6, nylon: 0xe9e5d9, ledGreen: 0x2c8a37, ledAmber: 0xc98617, bezel: 0x131415,
  speaker: 0x18191b, sd: 0x2a2c30,
};
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

// ---------------------------------------------------------------------------------------------------
// shared materials + the marking atlas

function createKit(Q) {
  const atlas = buildAtlas(Q);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const mat = {
    tin: std({ color: 0xe2e4e7, metalness: 1, roughness: 0.24 }),
    steel: std({ color: 0xd3d6da, metalness: 1, roughness: 0.2 }),
    gold: std({ color: new THREE.Color().setRGB(1.0, 0.77, 0.37), metalness: 1, roughness: 0.2 }),
    brass: std({ color: new THREE.Color().setRGB(0.86, 0.66, 0.34), metalness: 1, roughness: 0.24 }),
    plastic: std({ vertexColors: true, roughness: 0.44, metalness: 0 }),
    atlas: std({ map: atlas.map, roughnessMap: atlas.orm, metalnessMap: atlas.orm, roughness: 1, metalness: 1 }),
    smd: std({ roughness: 0.46, metalness: 0 }),
    fr4: std({ color: 0xcbbd94, roughness: 0.7 }),
    acrylic: clearMaterial(Q, { ior: 1.49, thickness: 3, tint: 0xf4fbf9 }),
    epoxy: clearMaterial(Q, { ior: 1.53, thickness: 4.5, tint: 0xffffff }),
  };
  // how strongly each material reflects the room's environment, relative to scene.environmentIntensity
  const env = [[mat.tin, 6.5], [mat.steel, 7], [mat.gold, 6], [mat.brass, 6.5], [mat.atlas, 5], [mat.plastic, 2], [mat.smd, 2], [mat.fr4, 1.5], [mat.acrylic, 1.2], [mat.epoxy, 3]];
  return { Q, atlas, mat, env, cell: (n) => atlas.get(n) };
}

function clearMaterial(Q, { ior, thickness, tint }) {
  if (Q.transmission) {
    return new THREE.MeshPhysicalMaterial({ color: tint, transmission: 1, ior, thickness, roughness: 0.035, metalness: 0, specularIntensity: 1,
      attenuationColor: new THREE.Color(0xe2f3ee), attenuationDistance: 0.3 });
  }
  if (Q.physical) return new THREE.MeshPhysicalMaterial({ color: tint, transparent: true, opacity: 0.2, roughness: 0.04, metalness: 0, ior, clearcoat: 1, clearcoatRoughness: 0.04, depthWrite: false });
  return new THREE.MeshStandardMaterial({ color: tint, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, depthWrite: false });
}

function buildAtlas(Q) {
  const A = new P.Atlas(Q.atlas, Q.atlas / 2048);
  const rand = P.rng(5);
  const fillAll = (g, w, h, pad, style) => { g.fillStyle = style; g.fillRect(-pad, -pad, w + pad * 2, h + pad * 2); };
  const speckle = (g, w, h, n, light, dark) => {
    for (let i = 0; i < n; i++) { g.fillStyle = rand() < 0.5 ? light : dark; g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2); }
  };
  const brushed = (g, w, h, vertical = false) => {
    for (let i = 0; i < (vertical ? w : h) * 0.8; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? "255,255,255" : "0,0,0"},${0.03 + rand() * 0.05})`;
      const p = rand() * (vertical ? w : h);
      if (vertical) g.fillRect(p, 0, 1, h); else g.fillRect(0, p, w, 1);
    }
  };
  /** Black epoxy package with laser-marked lines: [text, size (fraction of h), y (fraction), weight]. */
  const chip = (lines, { col = "#1d1d1f", ink = "#9b9b98", dot = true, rough = 0.5, inkRough = 0.82, metal = 0, inkMetal = 0, font = FONT } = {}) => (g, w, h, pass, pad) => {
    fillAll(g, w, h, pad, pass === "col" ? col : P.ormStyle(rough, metal));
    if (pass === "col") speckle(g, w, h, (w * h) / 60, "rgba(255,255,255,0.025)", "rgba(0,0,0,0.05)");
    if (dot) { g.fillStyle = pass === "col" ? "rgba(0,0,0,0.4)" : P.ormStyle(rough * 0.5, metal); g.beginPath(); g.arc(w * 0.1 + 4, h * 0.85 - 2, Math.min(w, h) * 0.055, 0, 7); g.fill(); }
    g.fillStyle = pass === "col" ? ink : P.ormStyle(inkRough, inkMetal);
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const [t, size, y, weight = 600] of lines) { g.font = `${weight} ${Math.round(size * h)}px ${font}`; g.fillText(t, w / 2, y * h, w * 0.9); }
  };
  const plain = (col, rough, metal = 0) => (g, w, h, pass, pad) => fillAll(g, w, h, pad, pass === "col" ? col : P.ormStyle(rough, metal));

  A.add("epoxy", 16, 16, plain("#1d1d1f", 0.5));
  A.add("socSub", 16, 16, plain("#27301f", 0.45));
  A.add("ferrite", 16, 16, plain("#2a2a2c", 0.62));
  A.add("tantSide", 16, 16, plain("#d7a128", 0.42));
  // BCM2711: nickel-plated lid with etched text (no logos)
  A.add("soc", 552, 552, (g, w, h, pass, pad) => {
    fillAll(g, w, h, pad, pass === "col" ? "#c7c9cc" : P.ormStyle(0.3, 1));
    if (pass === "col") brushed(g, w, h);
    g.fillStyle = pass === "col" ? "#8f9296" : P.ormStyle(0.58, 0.85);
    g.textAlign = "center"; g.textBaseline = "middle";
    [["BCM2711B0T", 0.1, 0.36, 700], ["SKRM T3", 0.075, 0.5, 600], ["TA0021 P11", 0.075, 0.61, 600], ["1949", 0.075, 0.72, 600]].forEach(([t, s, y, wgt]) => { g.font = `${wgt} ${s * h}px ${FONT}`; g.fillText(t, w / 2, y * h); });
    g.beginPath(); g.arc(w * 0.12, h * 0.12, w * 0.025, 0, 7); g.fill();
  });
  A.add("ram", 480, 600, chip([["D9WHV", 0.085, 0.42, 700], ["MT53E1G32D2FW", 0.045, 0.53], ["046 WT:C", 0.045, 0.6], ["9XM77", 0.045, 0.67]], { dot: false }));
  A.add("vl805", 320, 320, chip([["VL805-Q6", 0.12, 0.38, 700], ["1935 B2", 0.09, 0.53], ["TAIWAN", 0.09, 0.66]]));
  A.add("phy", 240, 240, chip([["54213PE", 0.13, 0.38, 700], ["B1KMLG", 0.1, 0.55], ["TB1932 P2", 0.09, 0.7]]));
  A.add("pmic", 200, 200, chip([["MXL7704", 0.14, 0.42, 700], ["X 1945", 0.11, 0.62]]));
  A.add("ind2r2", 160, 160, chip([["2R2", 0.3, 0.52, 700]], { col: "#2b2b2d", ink: "#8d8d8a", dot: false, rough: 0.62 }));
  A.add("ind1r0", 160, 160, chip([["1R0", 0.3, 0.52, 700]], { col: "#2b2b2d", ink: "#8d8d8a", dot: false, rough: 0.62 }));
  A.add("ind101", 160, 160, chip([["101", 0.32, 0.52, 700]], { col: "#262628", ink: "#cfcfca", dot: false, rough: 0.6 }));
  A.add("xtal54", 128, 100, chip([["54.000", 0.26, 0.5, 700]], { col: "#c9cbce", ink: "#8e9195", dot: false, rough: 0.32, metal: 1, inkRough: 0.6, inkMetal: 0.9 }));
  A.add("xtal25", 128, 100, chip([["25.000", 0.26, 0.5, 700]], { col: "#c9cbce", ink: "#8e9195", dot: false, rough: 0.32, metal: 1, inkRough: 0.6, inkMetal: 0.9 }));
  A.add("lm358", 196, 156, chip([["LM358", 0.22, 0.4, 700], ["9A2  S", 0.17, 0.66]]));
  A.add("lmv358", 196, 156, chip([["LMV358", 0.22, 0.4, 700], ["TI 87K", 0.17, 0.66]]));
  A.add("stm32", 260, 176, chip([["STM32", 0.2, 0.33, 700], ["F030F4P6", 0.17, 0.55], ["GH24Z  VG", 0.15, 0.75]]));
  A.add("sot23", 116, 52, chip([["J3Y", 0.5, 0.52, 700]], { dot: false }));
  A.add("sot235", 116, 64, chip([["L5AB", 0.44, 0.52, 700]], { dot: false }));
  A.add("sma", 172, 104, (g, w, h, pass, pad) => {
    chip([["SS14", 0.36, 0.52, 700]], { dot: false })(g, w, h, pass, pad);
    g.fillStyle = pass === "col" ? "#8d8d8b" : P.ormStyle(0.7); g.fillRect(w * 0.08, 0, w * 0.1, h);
  });
  A.add("tant", 128, 104, (g, w, h, pass, pad) => {
    fillAll(g, w, h, pad, pass === "col" ? "#d9a32a" : P.ormStyle(0.42));
    g.fillStyle = pass === "col" ? "#6e4a17" : P.ormStyle(0.5); g.fillRect(0, 0, w * 0.2, h);
    g.fillStyle = pass === "col" ? "#5a3c10" : P.ormStyle(0.6); g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${h * 0.3}px ${FONT}`; g.fillText("476", w * 0.6, h * 0.38); g.font = `600 ${h * 0.22}px ${FONT}`; g.fillText("16K", w * 0.6, h * 0.68);
  });
  // MP503-style gas sensor: crimped stainless can with a fine mesh window
  A.add("gasTop", 400, 400, (g, w, h, pass, pad) => {
    fillAll(g, w, h, pad, pass === "col" ? "#c3c6c9" : P.ormStyle(0.32, 1));
    const cx = w / 2, R = w / 2;
    if (pass === "col") { brushed(g, w, h); g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 6; g.beginPath(); g.arc(cx, cx, R * 0.93, 0, 7); g.stroke(); }
    g.save(); g.beginPath(); g.arc(cx, cx, R * 0.76, 0, 7); g.clip();
    g.fillStyle = pass === "col" ? "#2a2c2e" : P.ormStyle(0.9, 0); g.fillRect(0, 0, w, h);
    g.strokeStyle = pass === "col" ? "#9a9da1" : P.ormStyle(0.42, 1); g.lineWidth = 3.4;
    for (let i = -w; i < w * 2; i += 9) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + w, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + w, 0); g.stroke(); }
    g.restore();
    g.strokeStyle = pass === "col" ? "#e2e4e6" : P.ormStyle(0.22, 1); g.lineWidth = 5; g.beginPath(); g.arc(cx, cx, R * 0.78, 0, 7); g.stroke();
  });
  A.add("gasSide", 512, 128, (g, w, h, pass, pad) => {
    fillAll(g, w, h, pad, pass === "col" ? "#c0c3c7" : P.ormStyle(0.34, 1));
    if (pass === "col") { brushed(g, w, h, true); g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, h * 0.04, w, h * 0.06); g.fillRect(0, h * 0.88, w, h * 0.05); }
  });
  // speaker grille: perforated steel, hex-packed holes
  A.add("grille", 560, 560, (g, w, h, pass, pad) => {
    fillAll(g, w, h, pad, pass === "col" ? "#5d6064" : P.ormStyle(0.42, 0.95));
    if (pass === "col") brushed(g, w, h);
    g.fillStyle = pass === "col" ? "#050506" : P.ormStyle(1, 0);
    const step = 15.5, r = 5.2, c = w / 2;
    for (let j = 0, y = step / 2; y < h; y += step * 0.866, j++) for (let x = (j % 2) * step / 2 + step / 4; x < w; x += step) {
      if ((x - c) ** 2 + (y - c) ** 2 < (c * 0.93) ** 2) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    }
    g.strokeStyle = pass === "col" ? "#26282a" : P.ormStyle(0.6, 0.6); g.lineWidth = 10; g.beginPath(); g.arc(c, c, c * 0.97, 0, 7); g.stroke();
  });
  A.add("sd", 264, 360, (g, w, h, pass, pad) => {
    fillAll(g, w, h, pad, pass === "col" ? "#2b2d31" : P.ormStyle(0.5));
    g.fillStyle = pass === "col" ? "#b8202a" : P.ormStyle(0.5); g.fillRect(0, h * 0.62, w, h * 0.12);
    g.fillStyle = pass === "col" ? "#e8e8e4" : P.ormStyle(0.6); g.textAlign = "center"; g.font = `800 ${h * 0.12}px ${FONT}`; g.fillText("32GB", w / 2, h * 0.4);
  });
  return A.build(Q.aniso);
}

// ---------------------------------------------------------------------------------------------------
// small builders

/** Place an IC package (body → atlas batch, leads → tin batch) at board (X, Y) through toLocal, on top. */
function chipAt(B, kit, kind, cell, X, Y, rot, top, toLocal, opts = {}) {
  const pk = P.icPackage(kind, { epoxy: kit.cell(opts.side || "epoxy"), ...(opts.cells || {}) }, { ...opts, cell: kit.cell(cell), side: kit.cell(opts.side || "epoxy") });
  const [x, z] = toLocal(X, Y), m = P.mat4(x, top, z, rot);
  B.add("atlas", pk.body, null, m);
  if (pk.leads) B.add("tin", pk.leads, null, m);
}

/** Cylinder part with an atlas top and side (inductors, gas sensor can). */
function atlasCyl(B, kit, r, h, x, y, z, topCell, sideCell, seg = 28) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1).translate(x, y + h / 2, z);
  P.atlasUV(g, kit.cell(topCell), kit.cell(sideCell), kit.cell(sideCell));
  B.add("atlas", g);
}

function hexStandoff(r, h, x, y, z) { return P.flat(new THREE.CylinderGeometry(r, r, h, 6, 1).translate(x, y + h / 2, z)); }

/** Pan-head screw (dome head + cross recess), sitting on y. */
function screw(B, x, y, z, key = "tin", color = null, recess = C.cavity, scale = 1) {
  const pts = [[0, 1.75], [1.2, 1.72], [1.85, 1.45], [2.15, 0.9], [2.25, 0.3], [2.25, 0], [0, 0]].map(([a, b]) => new THREE.Vector2(a * scale, b * scale));
  const head = new THREE.LatheGeometry(pts.reverse(), 20).translate(x, y, z);
  B.add(key, head, color);
  B.add("plastic", P.box(x - 1.0 * scale, y + 1.66 * scale, z - 0.18 * scale, x + 1.0 * scale, y + 1.78 * scale, z + 0.18 * scale), recess);
  B.add("plastic", P.box(x - 0.18 * scale, y + 1.66 * scale, z - 1.0 * scale, x + 0.18 * scale, y + 1.78 * scale, z + 1.0 * scale), recess);
}

/** Occupancy grid in board space so vias, test points and designators avoid tracks and parts. */
class Occ {
  constructor(x0, y0, x1, y1, cell = 0.3) { Object.assign(this, { x0, y0, cell }); this.w = Math.ceil((x1 - x0) / cell); this.h = Math.ceil((y1 - y0) / cell); this.a = new Uint8Array(this.w * this.h); }
  _i(x, y) { const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((y - this.y0) / this.cell); return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i; }
  rect(x0, y0, x1, y1) { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += this.cell * 0.5) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += this.cell * 0.5) { const i = this._i(x, y); if (i >= 0) this.a[i] = 1; } }
  disc(x, y, r) { this.rect(x - r, y - r, x + r, y + r); }
  line(pts, r) {
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k], n = Math.ceil(Math.hypot(bx - ax, by - ay) / (this.cell * 0.5)) + 1;
      for (let t = 0; t <= n; t++) this.disc(ax + (bx - ax) * t / n, ay + (by - ay) * t / n, r);
    }
  }
  free(x0, y0, x1, y1) { for (let y = y0; y <= y1; y += this.cell * 0.5) for (let x = x0; x <= x1; x += this.cell * 0.5) { const i = this._i(x, y); if (i < 0 || this.a[i]) return false; } return true; }
}

/** 45° router: from a to b, straight then diagonal (or diagonal first). */
function r45(a, b, diagFirst = false) {
  const dx = b[0] - a[0], dy = b[1] - a[1], ax = Math.abs(dx), ay = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
  if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return [a, b];
  if (ax > ay) return diagFirst ? [a, [a[0] + sx * ay, b[1]], b] : [a, [b[0] - sx * ay, a[1]], b];
  return diagFirst ? [a, [b[0], a[1] + sy * ax], b] : [a, [a[0], b[1] - sy * ax], b];
}

/** Track helper bound to an art + occupancy. */
function tracker(art, occ) {
  return {
    t(pts, w = 0.13, clear = 0.12) { art.track(pts, w, clear); occ.line(pts, w / 2 + clear + 0.08); },
    bare(pts, w = 0.13) { art.trackBare(pts, w); occ.line(pts, w / 2 + 0.15); },
  };
}

/** Stitching vias + test points in free areas. */
function sprinkle(art, occ, rand, [x0, y0, x1, y1], step, { tp = 0, viaR = 0.2 } = {}) {
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const vx = x + (rand() - 0.5) * step * 0.6, vy = y + (rand() - 0.5) * step * 0.6;
    if (rand() < 0.55 && occ.free(vx - 0.45, vy - 0.45, vx + 0.45, vy + 0.45)) { art.via(vx, vy, viaR); occ.disc(vx, vy, 0.5); }
  }
  for (let i = 0, k = 0; i < tp && k < tp * 60; k++) {
    const vx = x0 + rand() * (x1 - x0), vy = y0 + rand() * (y1 - y0);
    if (occ.free(vx - 0.8, vy - 0.8, vx + 0.8, vy + 0.8)) { art.circle(art.SUB, vx, vy, 0.62); art.circle(art.GOLD, vx, vy, 0.46); occ.disc(vx, vy, 0.9); i++; }
  }
}

/** Designators next to SMD parts where there's room. */
function designators(art, occ, smd, rand, n) {
  let placed = 0;
  for (const it of [...smd.items].sort(() => rand() - 0.5)) {
    if (placed >= n) break;
    const p = it.kind === "r" ? "R" : it.kind === "l" ? "L" : "C";
    const label = p + (1 + Math.floor(rand() * (p === "C" ? 240 : 90)));
    const s = 0.62, w = label.length * s * 0.62, h = s;
    for (const [dx, dy] of [[0, 1.0], [0, -1.0], [1.3, 0], [-1.3, 0]]) {
      const cx = it.x + dx, cy = it.y + dy;
      if (occ.free(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) && smd._free([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2])) {
        art.text(art.SILK, label, cx, cy, s * 0.78, { weight: 700 }); occ.rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2); placed++; break;
      }
    }
  }
}

/** Connector shell extruded along X (Pi space) from a Y–Z profile with rounded top edges and cavities. */
function shellX(Y0, Y1, Z1, holes, X0, X1, r = 0.7) {
  const s = new THREE.Shape();
  s.moveTo(Y0, 0); s.lineTo(Y1, 0); s.lineTo(Y1, Z1 - r); s.quadraticCurveTo(Y1, Z1, Y1 - r, Z1); s.lineTo(Y0 + r, Z1); s.quadraticCurveTo(Y0, Z1, Y0, Z1 - r); s.closePath();
  for (const [a0, a1, b0, b1] of holes) { const h = new THREE.Path(); h.moveTo(a0, b0); h.lineTo(a0, b1); h.lineTo(a1, b1); h.lineTo(a1, b0); h.closePath(); s.holes.push(h); }
  return new THREE.ExtrudeGeometry(s, { depth: X1 - X0, bevelEnabled: false, curveSegments: 4 }).rotateY(Math.PI / 2).translate(px(X0), PI_TOP, 28);
}

// ---------------------------------------------------------------------------------------------------
// Raspberry Pi 4 Model B

function buildPi(kit) {
  const Q = kit.Q, rand = P.rng(42);
  const part = new THREE.Group(); part.name = "pi";
  const body = new THREE.Group(); body.scale.setScalar(S); part.add(body);
  const B = new P.Batch();
  const smd = new P.SmdSet(11, Q);
  const toLocal = (X, Y) => [px(X), pz(Y)];

  // ---- footprints (drawing coordinates, mm from the bottom-left corner) ----
  const parts = {
    soc: [21.5, 24.8, 36.7, 40.0], ram: [38.6, 24.9, 50.6, 39.9], wifi: [6.6, 36.3, 17.3, 49.2], phy: [55.2, 35.1, 61.2, 41.1],
    vl805: [55.4, 20.2, 63.4, 28.2], pmic: [7.2, 9.8, 12.2, 14.8], ind1: [12.4, 13.8, 16.6, 18.0], ind2: [17.9, 6.1, 22.5, 10.7],
    usbc: [6.7, -1.2, 15.7, 6.2], hdmi0: [22.8, -1.0, 29.2, 6.6], hdmi1: [36.3, -1.0, 42.7, 6.6], csi: [44.6, 0.0, 48.3, 23.2],
    audio: [50.8, -2.6, 57.2, 12.3], dsi: [1.8, 15.8, 5.4, 39.2], gpio: [7.0, 49.9, 58.0, 55.1], poe: [58.9, 43.8, 64.1, 48.9],
    eth: [66.0, 38.0, 85.0, 56.0], usb3: [70.2, 20.2, 85.0, 33.8], usb2: [70.2, 2.2, 85.0, 15.8], leds: [0.6, 8.2, 2.6, 12.4],
    xtal1: [17.9, 34.2, 21.1, 36.8], xtal2: [62.1, 31.1, 65.3, 33.7], j2: [8.0, 19.3, 16.0, 21.7], title: [17.2, 15.6, 37.4, 20.3],
    antenna: [0.6, 36.6, 6.3, 49.4], sot1: [51.6, 15.6, 54.6, 18.4], sot2: [14.5, 20.6, 17.5, 23.4],
  };
  for (const r of Object.values(parts)) smd.keepout(...r, 0.25);
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => smd.keepout(x - 3.2, y - 3.2, x + 3.2, y + 3.2));
  smd.keepout(-1, -1, 86, 0.8); smd.keepout(-1, 55.2, 86, 57); smd.keepout(-1, -1, 0.8, 57); smd.keepout(84.2, -1, 86, 57);

  // ---- SMD passives: tidy decoupling rows around the SoC and RAM, then scatter in the free areas ----
  smd.row(20.3, 25.6, 13, 0, 1.1, "0402", 1, (i) => (i % 3 ? "c" : "c2"));
  smd.row(22.4, 23.7, 13, 1.1, 0, "0402", 0, (i) => (i % 4 ? "c" : "r"));
  smd.row(22.4, 40.95, 13, 1.1, 0, "0201", 0, "c");
  smd.row(37.65, 25.8, 17, 0, 0.82, "0201", 1, "c");
  smd.row(51.5, 25.6, 13, 0, 1.1, "0402", 1, (i) => (i % 3 ? "c" : "r"));
  smd.add(5.6, 16.2, "0805", 1, "c"); smd.add(17.4, 12.4, "1206", 0, "c3"); smd.add(17.2, 15.4, "0805", 0, "c"); smd.add(5.2, 12.2, "0805", 1, "c");
  smd.add(24.5, 8.4, "0805", 1, "c"); smd.add(33.0, 9.6, "0805", 1, "c2"); smd.add(66.0, 17.5, "0805", 1, "c");
  [[17.6, 37.3, 22.0, 49.4, 26], [5.6, 6.8, 20.8, 19.2, 34], [50.5, 12.6, 69.6, 19.8, 38], [51.2, 28.6, 69.4, 34.8, 34], [51.2, 41.6, 66.0, 49.6, 30],
    [30.6, 6.8, 36.0, 11.6, 10], [16.3, 6.6, 22.6, 15.6, 12], [42.9, 7.2, 44.2, 22.0, 5], [62.0, 21.0, 69.6, 27.8, 14], [7.0, 21.8, 20.8, 35.4, 26],
    [61.6, 34.0, 65.8, 43.0, 12], [37.4, 7.0, 43.0, 11.4, 6], [58.0, 6.0, 69.6, 12.4, 16]].forEach(([a, b, c, d, n]) => smd.scatter([a, b, c, d], n));

  // ---- top art ----
  const art = new P.BoardArt({ bounds: [0, 0, 85, 56], pxmm: Q.pxmm, normals: Q.normals, palette: { sub: "#1b5a2c", cu: "#2b7a3d", via: "#226a37" } });
  const occ = new Occ(0, 0, 85, 56, 0.3);
  const tk = tracker(art, occ);
  art.all(art.CU);
  for (const r of Object.values(parts)) occ.rect(r[0] - 0.3, r[1] - 0.3, r[2] + 0.3, r[3] + 0.3);
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => occ.disc(x, y, 3.4));
  occ.rect(-1, -1, 86, 0.9); occ.rect(-1, 55.1, 86, 57); occ.rect(-1, -1, 0.9, 57); occ.rect(84.1, -1, 86, 57);
  for (const it of smd.items) occ.rect(...it.pad);

  // antenna: keep-out of bare laminate with a meander
  art.rect(art.SUB, 0.6, 36.6, 5.7, 12.8);
  tk.bare([[1.3, 48.6], [5.3, 48.6], [5.3, 46.9], [1.3, 46.9], [1.3, 45.2], [5.3, 45.2], [5.3, 43.5], [1.3, 43.5], [1.3, 41.8], [5.3, 41.8], [5.3, 40.1], [3.4, 40.1], [3.4, 37.4], [7.0, 37.4]], 0.32);
  // GPIO fan-out from the SoC to the header, routed in 45° steps without crossings
  {
    const n = 22, starts = [], targets = [];
    for (let i = 0; i < n; i++) { starts.push(22.5 + i * 0.6); targets.push(19.6 + i * (37.2 / (n - 1))); }
    const left = [], right = [];
    for (let i = 0; i < n; i++) (targets[i] < starts[i] ? left : right).push(i);
    const turn = {}; left.forEach((i, k) => (turn[i] = 42.7 + k * 0.4)); right.forEach((i, k) => (turn[i] = 42.7 + (right.length - 1 - k) * 0.4));
    for (let i = 0; i < n; i++) {
      const sx = starts[i], tx = targets[i], y = turn[i], c = Math.min(0.35, Math.abs(tx - sx) / 2), s = Math.sign(tx - sx);
      tk.t(Math.abs(tx - sx) < 0.05 ? [[sx, 40.0], [sx, 50.3]] : [[sx, 40.0], [sx, y - c], [sx + s * c, y], [tx - s * c, y], [tx, y + c], [tx, 50.3]], 0.12, 0.12);
    }
  }
  // RGMII to the Ethernet PHY over the top of the RAM
  for (let i = 0; i < 6; i++) { const y = 40.3 + i * 0.36, sy = 37.6 + i * 0.36; tk.t([[36.6, sy], [37.1, sy], [37.1 + (y - sy), y], [54.6 - i * 0.2, y], [55.3, y - 0.7 - i * 0.2]], 0.12, 0.11); }
  // HDMI0 / HDMI1 differential pairs
  for (let i = 0; i < 8; i++) { const sx = 23.0 + i * 0.4, tx = 24.3 + i * 0.4, y = 13.2 + i * 0.3; tk.t([[sx, 24.7], ...r45([sx, y], [tx, y - (tx - sx)]), [tx, 6.8]], 0.13, 0.1); }
  for (let i = 0; i < 8; i++) { const sx = 27.5 + i * 0.4, tx = 37.9 + i * 0.4, y = 11.9 + i * 0.4; tk.t([[sx, 24.7], [sx, y + 0.35], [sx + 0.35, y], [tx - 0.35, y], [tx, y - 0.35], [tx, 6.8]], 0.13, 0.1); }
  // camera (CSI) and PCIe to the VL805 USB controller
  for (let i = 0; i < 6; i++) { const sx = 31.4 + i * 0.4, y = 22.2 - i * 0.36; tk.t([[sx, 24.7], [sx, y + 0.35], [sx + 0.35, y], [44.4, y]], 0.13, 0.1); }
  for (let i = 0; i < 4; i++) { const sx = 34.4 + i * 0.4, y = 22.9 + i * 0.4; tk.t([[sx, 24.7], [sx, y + 0.3], [sx + 0.3, y], [55.3, y]], 0.13, 0.1); }
  // display (DSI) and SDIO to the wireless module
  for (let i = 0; i < 6; i++) { const y = 26.0 + i * 0.5; tk.t([[21.4, y], [8.0, y], [7.4, y + 0.6], [5.6, y + 0.6]], 0.13, 0.11); }
  for (let i = 0; i < 6; i++) { const sy = 34.2 + i * 0.5, ty = 37.0 + i * 0.4; tk.t([[21.4, sy], ...r45([19.6, sy], [17.4, ty])], 0.12, 0.11); }
  // USB pairs out of the VL805, Ethernet pairs out of the PHY
  for (let i = 0; i < 4; i++) { const y = 25.0 + i * 0.5; tk.t([[63.5, y], [70.3, y]], 0.14, 0.11); }
  for (let i = 0; i < 2; i++) { const y = 21.2 + i * 0.45; tk.t([[63.5, y], ...r45([66.3 + i * 0.45, y], [69.0 + i * 0.45, 12.0 + i * 0.45]), [70.3, 12.0 + i * 0.45]], 0.14, 0.11); }
  for (let i = 0; i < 8; i++) { const y = 35.6 + i * 0.6; tk.t([[61.3, y], [62.4, y], ...r45([62.4, y], [66.1, y + 1.4 + i * 0.25])], 0.13, 0.11); }
  // power: USB-C → PMIC → inductors, wide copper
  tk.t([[11.2, 6.3], [11.2, 8.4], [9.7, 9.9]], 0.8, 0.2);
  tk.t([[12.3, 13.0], [13.4, 13.0], [14.2, 13.8]], 0.6, 0.2);
  tk.t([[12.3, 11.0], [16.5, 11.0], [18.3, 9.2]], 0.6, 0.2);
  tk.t([[7.1, 12.3], [5.9, 12.3], [5.9, 21.0], [8.4, 23.5], [20.0, 23.5], [21.4, 24.9]], 0.5, 0.18);
  // short stubs from passives to vias
  for (const it of smd.items) {
    if (rand() > 0.42) continue;
    const L = P.SMD_SIZES[it.size][0] / 2 + 0.1, s = rand() < 0.5 ? -1 : 1, len = 0.6 + rand() * 1.0;
    const a = it.rot ? [it.x, it.y + s * L] : [it.x + s * L, it.y], b = it.rot ? [it.x, it.y + s * (L + len)] : [it.x + s * (L + len), it.y];
    if (occ.free(Math.min(a[0], b[0]) - 0.2, Math.min(a[1], b[1]) - 0.2, Math.max(a[0], b[0]) + 0.2, Math.max(a[1], b[1]) + 0.2) || len < 0.9) {
      art.track([a, b], 0.12, 0.1); art.via(b[0], b[1], 0.18, 0.1); occ.line([a, b], 0.25);
    }
  }
  // fan-out vias around the BGA packages
  for (const [x0, y0, x1, y1] of [parts.soc, parts.ram]) {
    for (let x = x0 + 0.6; x < x1; x += 0.8) for (const y of [y0 - 0.55, y1 + 0.55]) if (occ.free(x - 0.3, y - 0.3, x + 0.3, y + 0.3)) { art.via(x, y, 0.17, 0.09); occ.disc(x, y, 0.35); }
    for (let y = y0 + 0.6; y < y1; y += 0.8) for (const x of [x0 - 0.55, x1 + 0.55]) if (occ.free(x - 0.3, y - 0.3, x + 0.3, y + 0.3)) { art.via(x, y, 0.17, 0.09); occ.disc(x, y, 0.35); }
  }
  // the pour is pulled back from the board edge
  art.stroke(art.SUB, 1.1, (g) => g.roundRect(0, 0, 85, 56, 3));
  sprinkle(art, occ, rand, [1.2, 1.2, 84, 55], 1.9, { tp: 18 });

  // pads, holes and silkscreen
  smd.paint(art);
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => { art.circle(art.SUB, x, y, 3.25); art.circle(art.GOLD, x, y, 3.0); art.circle(art.HOLE, x, y, 1.4); });
  [9.46, 12.0, 14.54].forEach((x) => art.plated(x, 20.5, 0.5, 0.85)); art.box(art.SILK, 8.0, 19.25, 8.0, 2.5, 0.14);
  art.text(art.SILK, "J2", 12.0, 22.5, 0.75); art.text(art.SILK, "GLOBAL_EN", 12.0, 18.6, 0.5); art.text(art.SILK, "RUN", 16.9, 20.5, 0.5, { align: "left" });
  art.text(art.SILK, "Raspberry Pi 4 Model B", 17.4, 19.15, 1.3, { align: "left", weight: 700 });
  art.text(art.SILK, "© Raspberry Pi 2018", 17.4, 16.75, 0.95, { align: "left", weight: 600 });
  art.text(art.SILK, "DISPLAY", 6.6, 27.4, 0.9, { rot: Math.PI / 2 });
  art.text(art.SILK, "CAMERA", 43.4, 12.5, 0.9, { rot: Math.PI / 2 });
  art.text(art.SILK, "HDMI0", 26.0, 7.6, 0.75); art.text(art.SILK, "HDMI1", 39.5, 7.6, 0.75);
  art.text(art.SILK, "J14", 61.5, 42.6, 0.75); art.text(art.SILK, "POE", 65.0, 46.4, 0.62, { rot: Math.PI / 2 });
  art.text(art.SILK, "PWR", 3.4, 8.9, 0.52, { align: "left" }); art.text(art.SILK, "ACT", 3.4, 11.7, 0.52, { align: "left" });
  art.box(art.SILK, 6.85, 49.7, 51.3, 5.6, 0.16); art.rect(art.SILK, 7.0, 50.3, 0.35, 1.9); // GPIO outline + pin-1 mark
  art.text(art.SILK, "J8", 5.6, 50.5, 0.7);
  art.box(art.SILK, 58.75, 43.6, 5.5, 5.5, 0.14);
  art.box(art.SILK, 22.6, -0.6, 7.0, 7.4, 0.14); art.box(art.SILK, 36.1, -0.6, 7.0, 7.4, 0.14);
  designators(art, occ, smd, rand, 26);
  art.mottle(rand);
  const topMat = P.boardMaterial(art, Q);

  // underside: solder joints for the through-hole parts and the board text
  const bot = new P.BoardArt({ bounds: [0, 0, 85, 56], pxmm: Q.low ? 4 : 7, normals: false, orm: false, palette: { sub: "#1b5a2c", cu: "#2a763b" } });
  bot.all(bot.CU); bot.stroke(bot.SUB, 1.1, (g) => g.roundRect(0, 0, 85, 56, 3));
  for (let k = 0; k < 20; k++) for (const y of [51.23, 53.77]) bot.circle(bot.TIN, 8.37 + k * 2.54, y, 0.75);
  for (const [x0, y0, x1, y1] of [parts.eth, parts.usb3, parts.usb2]) { for (let i = 0; i < 4; i++) bot.circle(bot.TIN, x0 + 2 + i * 2.2, (y0 + y1) / 2 + (i % 2) * 1.5, 0.6); bot.rect(bot.TIN, x0 + 0.5, y0 + 0.4, 1.4, 1.6); bot.rect(bot.TIN, x0 + 0.5, y1 - 2.0, 1.4, 1.6); }
  bot.text(bot.SILK, "Raspberry Pi 4 Model B", 30, 30, 2.2, { weight: 700 });
  bot.text(bot.SILK, "Designed and Sold by Raspberry Pi", 30, 26.5, 1.2);
  const botMat = new THREE.MeshStandardMaterial({ map: P.canvasTex(bot.layers.col, true, Q.aniso), roughness: 0.48 });

  // ---- board mesh ----
  const shape = P.outlineShape([[0, 0, 3], [85, 0, 3], [85, 56, 3], [0, 56, 3]]);
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => P.addHole(shape, x, y, 1.35));
  const board = new THREE.Mesh(P.boardGeometry(shape, 1.4, [0, 0, 85, 56], 8).translate(-42.5, PI_TOP - 1.4, 28), [botMat, topMat, kit.mat.fr4]);
  board.castShadow = board.receiveShadow = true; board.name = "pi-board";
  body.add(board);

  // ---- chips ----
  B.add("atlas", P.atlasUV(bp(21.5, 36.7, 24.8, 40.0, 0, 0.95), kit.cell("socSub")));
  {
    const rr = P.outlineShape([[-6.9, -6.9, 1.2], [6.9, -6.9, 1.2], [6.9, 6.9, 1.2], [-6.9, 6.9, 1.2]]);
    const g = new THREE.ExtrudeGeometry(rr, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 2, curveSegments: 6 });
    g.rotateX(-Math.PI / 2).rotateY(Math.PI);
    // planar UVs from position so the top maps the lid cell squarely
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (-pos.getX(i) + 7.15) / 14.3, (pos.getZ(i) + 7.15) / 14.3); // reads from the room side
    g.computeVertexNormals();
    P.atlasUV(g, kit.cell("soc"), kit.cell("soc"), kit.cell("soc"));
    g.translate(px(29.1), PI_TOP + 0.95, pz(32.4));
    B.add("atlas", g);
  }
  chipAt(B, kit, "block", "ram", 44.6, 32.4, Math.PI, PI_TOP, toLocal, { L: 12.0, W: 15.0, H: 1.0 });
  chipAt(B, kit, "qfn", "vl805", 59.4, 24.2, Math.PI, PI_TOP, toLocal, { size: 8, h: 0.9 });
  chipAt(B, kit, "qfn", "phy", 58.2, 38.1, Math.PI, PI_TOP, toLocal, { size: 6, h: 0.85 });
  chipAt(B, kit, "qfn", "pmic", 9.7, 12.3, Math.PI / 2, PI_TOP, toLocal, { size: 5, h: 0.85 });
  chipAt(B, kit, "sot23", "sot23", 53.1, 17.0, 0, PI_TOP, toLocal);
  chipAt(B, kit, "sot23-5", "sot235", 16.0, 22.0, Math.PI, PI_TOP, toLocal);
  B.add("atlas", P.atlasUV(bp(17.9, 21.1, 34.2, 36.8, 0, 0.8), kit.cell("xtal54"), kit.cell("xtal54")));
  B.add("atlas", P.atlasUV(bp(62.1, 65.3, 31.1, 33.7, 0, 0.8), kit.cell("xtal25"), kit.cell("xtal25")));
  { // shielded inductors
    const g = P.flat(new THREE.CylinderGeometry(2.05, 2.05, 1.9, 8, 1).rotateY(Math.PI / 8).translate(px(14.5), PI_TOP + 0.95, pz(15.9)));
    P.atlasUV(g, kit.cell("ind2r2"), kit.cell("ferrite")); B.add("atlas", g);
    atlasCyl(B, kit, 2.3, 2.2, px(20.2), PI_TOP, pz(8.4), "ind1r0", "ferrite");
  }
  // wireless module under its plain shield can
  B.add("steel", bp(6.6, 17.3, 36.3, 49.2, 0, 1.55));
  B.add("steel", bp(7.0, 16.9, 36.7, 48.8, 1.55, 1.62));
  for (const [X, Y] of [[8.2, 38.0], [15.7, 38.0], [8.2, 47.5], [15.7, 47.5]]) B.add("plastic", P.cylB(0.35, 0.03, px(X), PI_TOP + 1.62, pz(Y), 10), 0x6f7378);

  // ---- connectors ----
  const usbStack = (Yc, tongue) => {
    const X0 = 70.4, X1 = 87.4, Y0 = Yc - 6.7, Y1 = Yc + 6.7, t = 0.35;
    B.add("steel", shellX(Y0, Y1, 16, [[Y0 + t, Y1 - t, t, 7.6], [Y0 + t, Y1 - t, 8.4, 16 - t]], X0, X1));
    B.add("steel", bp(X0, X0 + t, Y0, Y1, 0, 16));
    for (const g of [bp(X1, X1 + 0.3, Y0 - 0.45, Y0 + 0.5, -0.2, 16.4), bp(X1, X1 + 0.3, Y1 - 0.5, Y1 + 0.45, -0.2, 16.4), bp(X1, X1 + 0.3, Y0, Y1, 15.4, 16.4), bp(X1, X1 + 0.3, Y0, Y1, 7.3, 8.7), bp(X1, X1 + 0.3, Y0, Y1, -0.2, 0.6)]) B.add("steel", g);
    for (const [z0, z1, tz0, tz1] of [[t, 7.6, 4.5, 6.4], [8.4, 16 - t, 12.9, 14.8]]) {
      B.add("plastic", bp(X0 + t, 79.6, Y0 + t, Y1 - t, z0, z1), C.cavity);
      B.add("plastic", bp(79.6, 86.9, Yc - 5.6, Yc + 5.6, tz0, tz1), tongue);
      for (let k = 0; k < (tongue === C.usb3 ? 9 : 4); k++) { const y = Yc - 4.2 + k * (8.4 / ((tongue === C.usb3 ? 9 : 4) - 1)); B.add("gold", bp(82.0, 86.6, y - 0.3, y + 0.3, tz0 - 0.08, tz0)); }
    }
    B.add("tin", bp(X0 + 0.6, X0 + 1.6, Y0 - 0.25, Y0, -1.4, 3)); B.add("tin", bp(X0 + 0.6, X0 + 1.6, Y1, Y1 + 0.25, -1.4, 3));
  };
  usbStack(27.0, C.usb3);
  usbStack(9.0, C.black);
  // stamped spring tabs and seams on the shells (thin dark slots read as cut lines in the metal)
  const slot = (X0, X1, Y0, Y1, Z) => B.add("plastic", bp(X0, X1, Y0, Y1, Z, Z + 0.04), 0x2a2c2f);
  const tabTop = (Xa, Xb, Yc, w, Z) => { slot(Xa, Xb, Yc - w / 2 - 0.12, Yc - w / 2, Z); slot(Xa, Xb, Yc + w / 2, Yc + w / 2 + 0.12, Z); slot(Xb - 0.12, Xb, Yc - w / 2, Yc + w / 2, Z); };
  for (const Yc of [27.0, 9.0]) { tabTop(74.0, 78.5, Yc - 3.2, 2.2, 16); tabTop(74.0, 78.5, Yc + 3.2, 2.2, 16); slot(71.2, 86.8, Yc - 0.06, Yc + 0.06, 16); }
  tabTop(70.0, 75.0, 41.5, 2.6, 13.5); tabTop(70.0, 75.0, 50.0, 2.6, 13.5); slot(77.0, 86.8, 45.7, 45.82, 13.5);
  for (const X of [79.5, 83.5]) B.add("plastic", P.cylB(0.55, 0.04, px(X), PI_TOP + 13.5, pz(45.75), 12), 0x2a2c2f);
  { // RJ45 jack with LEDs
    const X0 = 66.4, X1 = 87.6, Y0 = 38.0, Y1 = 53.5, t = 0.35;
    B.add("steel", shellX(Y0, Y1, 13.5, [[Y0 + t, Y1 - t, 0.01, 13.5 - t]], X0, X1 - t));
    B.add("steel", bp(X0, X0 + t, Y0, Y1, 0, 13.5));
    for (const g of [bp(X1 - t, X1, Y0, 39.9, 0, 13.5), bp(X1 - t, X1, 51.6, Y1, 0, 13.5), bp(X1 - t, X1, 39.9, 51.6, 0, 2.2), bp(X1 - t, X1, 39.9, 51.6, 12.2, 13.5),
      bp(X1 - t, X1, 39.9, 42.75, 10.6, 12.2), bp(X1 - t, X1, 48.75, 51.6, 10.6, 12.2)]) B.add("steel", g);
    B.add("plastic", bp(X0 + t, 80.0, Y0 + t, Y1 - t, 0, 13.5 - t), C.cavity);
    B.add("plastic", bp(80.0, X1 - t, Y0 + t, 39.9, 0, 13.5 - t), C.black); B.add("plastic", bp(80.0, X1 - t, 51.6, Y1 - t, 0, 13.5 - t), C.black);
    B.add("plastic", bp(80.0, X1 - t, 39.9, 51.6, 0, 2.2), C.black);
    for (let k = 0; k < 8; k++) { const y = 41.2 + k * 1.02; B.add("gold", bp(81.0, 85.5, y - 0.18, y + 0.18, 9.0, 9.25)); }
    B.add("plastic", bp(X1, X1 + 0.15, 39.3, 41.5, 0.5, 1.8), C.ledGreen);
    B.add("plastic", bp(X1, X1 + 0.15, 50.0, 52.2, 0.5, 1.8), C.ledAmber);
  }
  { // USB-C receptacle (stadium shell with a real opening)
    const stadium = (w, h) => { const r = h / 2, s = new THREE.Shape(); s.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false); s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false); s.closePath(); return s; };
    const outer = stadium(8.94, 3.26), inner = stadium(8.3, 2.6); outer.holes.push(new THREE.Path(inner.getPoints(16).reverse()));
    const shell = new THREE.ExtrudeGeometry(outer, { depth: 7.35, bevelEnabled: false, curveSegments: 10 }).translate(px(11.2), PI_TOP + 1.63, pz(6.15));
    B.add("steel", shell);
    B.add("plastic", new THREE.ExtrudeGeometry(inner, { depth: 0.2, bevelEnabled: false, curveSegments: 10 }).translate(px(11.2), PI_TOP + 1.63, pz(5.0)), C.cavity);
    B.add("plastic", bp(11.2 - 3.3, 11.2 + 3.3, -0.6, 5.0, 1.33, 1.93), C.black);
    B.add("tin", bp(6.4, 7.0, 3.0, 5.0, -1.4, 1.2)); B.add("tin", bp(15.4, 16.0, 3.0, 5.0, -1.4, 1.2));
  }
  { // micro HDMI ×2
    const trap = (w, h, c) => { const s = new THREE.Shape(); s.moveTo(-w / 2, h); s.lineTo(w / 2, h); s.lineTo(w / 2, c); s.lineTo(w / 2 - c, 0); s.lineTo(-w / 2 + c, 0); s.lineTo(-w / 2, c); s.closePath(); return s; };
    for (const X of [26.0, 39.5]) {
      const outer = trap(6.4, 3.0, 0.9), inner = trap(5.8, 2.4, 0.7);
      const ip = inner.getPoints().map((p) => new THREE.Vector2(p.x, p.y + 0.3)).reverse(); outer.holes.push(new THREE.Path(ip));
      B.add("steel", new THREE.ExtrudeGeometry(outer, { depth: 7.5, bevelEnabled: false }).translate(px(X), PI_TOP, pz(6.5)));
      B.add("plastic", bp(X - 2.9, X + 2.9, 4.6, 5.0, 0.3, 2.7), C.cavity);
      B.add("plastic", bp(X - 2.2, X + 2.2, -0.5, 4.6, 1.25, 1.75), C.black);
    }
  }
  { // 3.5 mm A/V jack
    B.add("plastic", bp(50.9, 57.1, 0.5, 12.2, 0, 6.0), C.black);
    B.add("plastic", P.cylZ(2.5, 3.0, px(54.0), PI_TOP + 3.0, pz(0.5), 28), C.black);
    B.add("plastic", P.cylZ(1.75, 0.05, px(54.0), PI_TOP + 3.0, pz(-2.5) - 0.04, 20), 0x050505);
    B.add("plastic", bp(51.6, 56.4, 12.2, 12.6, 0.8, 4.4), 0x101010);
  }
  { // CSI and DSI flex connectors with brown latches
    const ffc = (X0, X1, Y0, Y1) => {
      B.add("plastic", bp(X0, X1, Y0, Y1, 0, 4.0), C.black);
      B.add("plastic", bp(X0 - 0.2, X1 + 0.3, Y0 + 0.3, Y1 - 0.3, 4.0, 5.5), C.latch);
      B.add("plastic", bp(X1 - 0.05, X1 + 0.06, Y0 + 0.6, Y1 - 0.6, 3.0, 4.0), C.cavity);
      B.add("tin", bp(X0 + 0.6, X1 - 0.6, Y0 - 0.6, Y0, 0, 1.8)); B.add("tin", bp(X0 + 0.6, X1 - 0.6, Y1, Y1 + 0.6, 0, 1.8));
      for (let k = 0; k < 15; k++) { const y = (Y0 + Y1) / 2 + (k - 7) * 1.0; B.add("tin", bp(X0 - 0.6, X0, y - 0.15, y + 0.15, 0, 0.22)); }
    };
    ffc(44.8, 48.0, 0.6, 22.6);
    ffc(2.0, 5.2, 16.4, 38.6);
  }
  // GPIO header + PoE header (bases; pins are instanced below)
  B.add("plastic", bp(7.1, 57.9, 49.96, 55.04, 0, 2.5), C.header);
  for (let k = 0; k < 20; k++) B.add("plastic", bp(8.37 + k * 2.54 - 0.12, 8.37 + k * 2.54 + 0.12, 49.94, 55.06, 1.4, 2.52), 0x1e1e1e);
  B.add("plastic", bp(58.96, 64.04, 43.82, 48.9, 0, 2.5), C.header);
  // LED bodies
  for (const y of [9.0, 11.6]) B.add("plastic", bp(0.8, 2.4, y - 0.4, y + 0.4, 0, 0.28), 0xe8e6df);
  // standoffs: under the Pi (to the sill) and between Pi and HAT
  for (const [X, Y] of [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]) {
    B.add("brass", hexStandoff(2.887, PI_TOP - 1.4, px(X), 0, pz(Y)));
    B.add("brass", hexStandoff(2.887, 11.0, px(X), PI_TOP, pz(Y)));
  }
  // microSD socket and card underneath
  B.add("steel", bp(1.0, 15.2, 22.0, 35.0, -3.0, -1.4));
  B.add("atlas", P.atlasUV(bp(-2.5, 12.6, 22.9, 33.9, -2.65, -2.0), kit.cell("sd"), kit.cell("epoxy"), kit.cell("sd")));

  const meshes = B.build(body, kit.mat);
  smd.build(body, kit, toLocal, PI_TOP);

  // header pins (gold, instanced): 2×20 GPIO + 2×2 PoE
  const pinMats = [];
  for (let k = 0; k < 20; k++) for (const Y of [51.23, 53.77]) pinMats.push(P.mat4(px(8.37 + k * 2.54), PI_TOP, pz(Y)));
  for (const [X, Y] of [[60.23, 45.09], [62.77, 45.09], [60.23, 47.63], [62.77, 47.63]]) pinMats.push(P.mat4(px(X), PI_TOP, pz(Y)));
  body.add(P.instanced(P.pinGeometry(8.5, 0.64, 0.45), kit.mat.gold, pinMats));

  // status LEDs: red PWR (on), green ACT (blinks)
  const pwrMat = new THREE.MeshStandardMaterial({ color: 0x6a0f0a, emissive: 0xff2412, emissiveIntensity: 3.2, roughness: 0.3 });
  const actMat = new THREE.MeshStandardMaterial({ color: 0x0e3d14, emissive: 0x38ff52, emissiveIntensity: 0.1, roughness: 0.3 });
  for (const [y, m] of [[9.0, pwrMat], [11.6, actMat]]) {
    const led = new THREE.Mesh(bp(0.95, 2.25, y - 0.32, y + 0.32, 0.28, 0.62), m); led.castShadow = led.receiveShadow = true; body.add(led);
  }
  return { part, board, actMat, pwrMat, meshes };
}

// ---------------------------------------------------------------------------------------------------
// Grove Base HAT for Raspberry Pi

const HAT_SOCKETS = [ // name, X, Y (centre, Pi drawing coordinates), pin labels top→bottom
  ["PWM", 9.6, 40.1, ["12", "13", "3V3", "GND"]], ["D5", 19.6, 40.1, ["5", "6", "3V3", "GND"]], ["D16", 29.0, 40.1, ["16", "17", "3V3", "GND"]],
  ["D18", 38.8, 40.1, ["18", "19", "3V3", "GND"]], ["A0", 51.4, 40.1, ["A0", "A1", "3V3", "GND"]], ["A2", 61.0, 40.1, ["A2", "A3", "3V3", "GND"]],
  ["UART", 9.6, 23.5, ["RX", "TX", "3V3", "GND"]], ["D22", 19.6, 23.5, ["22", "23", "3V3", "GND"]], ["D24", 29.0, 23.5, ["24", "25", "3V3", "GND"]],
  ["D26", 38.8, 23.5, ["26", "27", "3V3", "GND"]], ["A4", 51.4, 23.5, ["A4", "A5", "3V3", "GND"]], ["A6", 61.0, 23.5, ["A6", "A7", "3V3", "GND"]],
  ["I2C", 19.6, 7.7, ["SCL", "SDA", "3V3", "GND"]], ["I2C", 29.0, 7.7, ["SCL", "SDA", "3V3", "GND"]], ["I2C", 38.8, 7.7, ["SCL", "SDA", "3V3", "GND"]],
];

function buildHat(kit) {
  const Q = kit.Q, rand = P.rng(77);
  const part = new THREE.Group(); part.name = "hat";
  const body = new THREE.Group(); body.scale.setScalar(S); part.add(body);
  const B = new P.Batch(), smd = new P.SmdSet(23, Q);
  const toLocal = (X, Y) => [px(X), pz(Y)];
  const bounds = [0, -0.5, 65, 56];

  // passives near the MCU, SWD and sockets
  [[42.4, 36.6, "0603", 1, "c"], [47.8, 36.6, "0603", 1, "c"], [45.1, 27.2, "0603", 0, "r"], [42.6, 27.0, "0402", 1, "c"], [47.9, 26.8, "0402", 1, "r"],
    [44.0, 15.8, "0603", 0, "r"], [46.2, 17.0, "0603", 0, "c"], [63.0, 15.6, "0603", 1, "c"], [14.0, 31.6, "0603", 0, "c"], [33.4, 31.6, "0603", 0, "r"],
    [57.3, 31.5, "0603", 0, "c"], [44.8, 47.0, "0603", 0, "c"], [24.4, 15.4, "0402", 0, "r"]].forEach(([x, y, s, r, k]) => smd.add(x, y, s, r, k, true));

  const art = new P.BoardArt({ bounds, pxmm: Q.pxmm, normals: Q.normals, palette: { sub: "#15853f", cu: "#21a24f", via: "#1a9447" } });
  const occ = new Occ(...bounds, 0.3), tk = tracker(art, occ);
  art.all(art.CU);
  for (const [, X, Y] of HAT_SOCKETS) occ.rect(X - 3.0, Y - 6.2, X + 3.4, Y + 5.6);
  occ.rect(7.0, 49.8, 58.0, 55.2); occ.rect(41.6, 28.2, 48.6, 35.4); occ.rect(47.0, 4.5, 63.5, 15.0);
  for (const it of smd.items) occ.rect(...it.pad);
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => occ.disc(x, y, 3.3));
  occ.rect(-1, -1, 66, 0.4); occ.rect(-1, 55.1, 66, 57); occ.rect(-1, -1, 0.9, 57); occ.rect(64.1, -1, 66, 57); occ.rect(-1, 17.2, 3.6, 50);

  // buses in the channels between socket columns, dropping out of the header
  const channels = [[13.2, 3, 3.2], [23.0, 2, 3.2], [32.5, 2, 3.2], [55.2, 2, 17.0]];
  for (const [x, n, yEnd] of channels) for (let i = 0; i < n; i++) {
    const X = x + i * 0.42, pin = 8.37 + Math.round((X - 8.37) / 2.54) * 2.54;
    tk.t([[pin, 50.2], ...r45([pin, 49.2], [X, 49.2 - Math.abs(X - pin)]), [X, yEnd + i * 0.6]], 0.2, 0.16);
  }
  // stubs from each socket's pins out to the side, ending in vias
  for (const [, X, Y] of HAT_SOCKETS) for (const d of [3, 1, -1, -3]) {
    const y = Y + d, x1 = X - 2.7 - 0.5 - rand() * 0.6;
    art.track([[X - 0.35, y], [x1, y]], 0.2, 0.15); art.via(x1, y, 0.22, 0.12);
  }
  // MCU to the analog sockets
  for (let i = 0; i < 4; i++) { const y = 29.6 + i * 0.65; tk.t([[48.4, y], ...r45([49.0, y], [50.4, y + (i < 2 ? -2.6 : 2.6)])], 0.18, 0.14); }
  art.stroke(art.SUB, 1.0, (g) => hatPath(g));
  sprinkle(art, occ, rand, [1.4, 0.6, 64, 49], 2.4, { tp: 6, viaR: 0.24 });

  // header pads, mounting holes, SWD
  for (let k = 0; k < 20; k++) for (const Y of [51.23, 53.77]) {
    const X = 8.37 + k * 2.54;
    if (k === 0 && Y < 52) art.rect(art.TIN, X - 0.85, Y - 0.85, 1.7, 1.7); else art.circle(art.TIN, X, Y, 0.85);
  }
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => { art.circle(art.SUB, x, y, 3.0); art.circle(art.TIN, x, y, 2.75); art.circle(art.HOLE, x, y, 1.4); });
  for (let i = 0; i < 5; i++) for (const y of [10.67, 8.13]) art.plated(49.32 + i * 2.54, y, 0.5, 0.78);
  smd.paint(art);

  // silkscreen
  const SILK = art.SILK;
  for (const [name, X, Y, pins] of HAT_SOCKETS) {
    art.text(SILK, name, X, Y + 6.55, 1.05, { weight: 700 });
    pins.forEach((t, i) => art.text(SILK, t, X - 2.95, Y + 3 - i * 2, 0.78, { align: "right", weight: 700 }));
    art.box(SILK, X - 2.75, Y - 5.25, 5.5, 10.5, 0.13);
  }
  art.box(SILK, 47.2, 4.6, 14.4, 10.2, 0.15); art.line(SILK, 0.15, [[47.2, 12.6], [61.6, 12.6]]);
  ["3V3", "10", "9", "11", "GND"].forEach((t, i) => art.text(SILK, t, 49.32 + i * 2.54, 13.6, 0.6, { weight: 700 }));
  ["3V3", "RST", "DIO", "CLK", "GND"].forEach((t, i) => art.text(SILK, t, 49.32 + i * 2.54, 5.95, 0.6, { weight: 700 }));
  art.text(SILK, "SWD", 54.4, 3.6, 0.9, { weight: 700 });
  art.text(SILK, "RPI", 62.6, 10.67, 0.62, { align: "left" }); art.text(SILK, "MCU", 62.6, 8.13, 0.62, { align: "left" });
  art.text(SILK, "1", 8.37, 48.6, 0.8, { weight: 700 });
  art.text(SILK, "U1", 45.1, 36.0 + 1.5, 0.7);
  art.text(SILK, "Grove Base Hat for RasPi v1.1", 52.0, 18.6, 0.72, { weight: 700 });
  art.mottle(rand);
  const topMat = P.boardMaterial(art, Q);

  const bot = new P.BoardArt({ bounds, pxmm: Q.low ? 4 : 7, normals: false, orm: false, palette: { sub: "#15853f", cu: "#20a04e" } });
  bot.all(bot.CU);
  for (const [, X, Y] of HAT_SOCKETS) for (const d of [-3, -1, 1, 3]) bot.circle(bot.TIN, X - 0.35, Y + d, 0.62);
  bot.text(bot.SILK, "Grove Base Hat for RasPi", 32, 30, 2.0, { weight: 700 });
  const botMat = new THREE.MeshStandardMaterial({ map: P.canvasTex(bot.layers.col, true, Q.aniso), roughness: 0.48 });

  const shape = new THREE.Shape(); hatPath(shape);
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => P.addHole(shape, x, y, 1.375));
  const board = new THREE.Mesh(P.boardGeometry(shape, 1.6, bounds, 8).translate(-42.5, HAT_TOP - 1.6, 28), [botMat, topMat, kit.mat.fr4]);
  board.castShadow = board.receiveShadow = true; body.add(board);

  // stacking header: female body under the board, long pins through it
  B.add("plastic", bp(7.1, 57.9, 49.96, 55.04, 9.9, HAT_TOP - 1.6, 0), C.header);
  for (let k = 0; k < 20; k++) for (const Y of [51.23, 53.77]) B.add("tin", new THREE.CylinderGeometry(0.42, 0.85, 0.55, 10, 1).translate(px(8.37 + k * 2.54), HAT_TOP + 0.27, pz(Y)));
  // MCU
  chipAt(B, kit, "tssop20", "stm32", 45.1, 31.8, -Math.PI / 2, HAT_TOP, toLocal);
  // screws on the mounting holes
  for (const [X, Y] of [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]) screw(B, px(X), HAT_TOP, pz(Y));
  B.build(body, kit.mat);
  smd.build(body, kit, toLocal, HAT_TOP);

  const pinMats = [];
  for (let k = 0; k < 20; k++) for (const Y of [51.23, 53.77]) pinMats.push(P.mat4(px(8.37 + k * 2.54), HAT_TOP, pz(Y)));
  body.add(P.instanced(P.pinGeometry(9.6, 0.64, 0.5), kit.mat.gold, pinMats));

  // 15 Grove sockets, instanced
  const sock = P.groveSocketVertical(C.cream), sockMats = HAT_SOCKETS.map(([, X, Y]) => P.mat4(px(X), HAT_TOP, pz(Y)));
  body.add(P.instanced(sock.plastic, kit.mat.plastic, sockMats));
  body.add(P.instanced(sock.pins, kit.mat.tin, sockMats));

  const plugAt = {}; // socket name → Object3D at the plug's frame (for cables)
  for (const [i, name] of [[4, "A0"], [5, "A2"], [14, "I2C"]]) {
    const o = new THREE.Object3D(); o.applyMatrix4(P.mat4(px(HAT_SOCKETS[i][1]), HAT_TOP + 1.45, pz(HAT_SOCKETS[i][2]))); body.add(o); plugAt[name] = o;
  }
  return { part, plugAt };
}

/** HAT outline: 65 × 56.5 mm, 3 mm corners, display-cable notch on the left edge. */
function hatPath(g) {
  const r = 3, y0 = -0.5, y1 = 56;
  g.moveTo(r, y0); g.lineTo(65 - r, y0); g.quadraticCurveTo(65, y0, 65, y0 + r); g.lineTo(65, y1 - r); g.quadraticCurveTo(65, y1, 65 - r, y1);
  g.lineTo(r, y1); g.quadraticCurveTo(0, y1, 0, y1 - r); g.lineTo(0, 50.0); g.lineTo(2.0, 50.0); g.quadraticCurveTo(2.7, 50.0, 2.7, 49.3);
  g.lineTo(2.7, 17.9); g.quadraticCurveTo(2.7, 17.2, 2.0, 17.2); g.lineTo(0, 17.2); g.lineTo(0, y0 + r); g.quadraticCurveTo(0, y0, r, y0);
  if (g.closePath) g.closePath();
}

// ---------------------------------------------------------------------------------------------------
// Grove modules: shared outline, board, art

function groveBoard(kit, { w, h, features, holes, palette, pxmm, thick = 1.6, draw, drawBottom }) {
  const Q = kit.Q;
  const shape = P.outlineShape([[0, 0, 1.0], [w, 0, 1.0], [w, h, 1.0], [0, h, 1.0]], features);
  holes.forEach(([x, y]) => P.addHole(shape, x, y, 1.0));
  const bounds = [-3, -3, w + 3, h + 3];
  const art = new P.BoardArt({ bounds, pxmm, normals: Q.normals, palette });
  art.all(art.CU);
  draw(art);
  holes.forEach(([x, y]) => { art.circle(art.TIN, x, y, 1.75); art.circle(art.HOLE, x, y, 1.05); });
  art.mottle(P.rng(w * 31 + h));
  const topMat = P.boardMaterial(art, Q);
  const bot = new P.BoardArt({ bounds, pxmm: Q.low ? 5 : 12, normals: false, orm: false, palette });
  bot.all(bot.CU); if (drawBottom) drawBottom(bot);
  holes.forEach(([x, y]) => bot.circle(bot.TIN, x, y, 1.75));
  const botMat = new THREE.MeshStandardMaterial({ map: P.canvasTex(bot.layers.col, true, Q.aniso), roughness: 0.48 });
  const geo = P.boardGeometry(shape, thick, bounds, 10);
  const mesh = new THREE.Mesh(geo, [botMat, topMat, kit.mat.fr4]);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const BLUE = { sub: "#1a4b94", cu: "#2763b6", via: "#1f56a5" };

/** Alternating Grove lugs (ears with holes) and notches around a w×h board in 20 mm units. */
function groveFeatures(spec) { return spec.map(([edge, at, type]) => ({ edge, at, type, r: type === "ear" ? 2.6 : 2.0 })); }

// ---- Grove Air Quality Sensor v1.3 (40 × 20) ----
function buildAir(kit) {
  const Q = kit.Q;
  const part = new THREE.Group(); part.name = "air";
  const body = new THREE.Group(); body.scale.setScalar(S); part.add(body);
  const B = new P.Batch(), smd = new P.SmdSet(31, Q);
  const W = 40, H = 20, BASE = 4.0, TOP = BASE + 1.6;
  const toLocal = (X, Y) => [X - W / 2, H / 2 - Y];
  const passives = [[12.3, 15.4, "0603", 1, "c"], [12.3, 12.0, "0603", 1, "r"], [14.6, 10.9, "0603", 1, "r"], [24.2, 17.4, "0603", 1, "r"], [10.9, 4.6, "0805", 1, "c"],
    [9.0, 4.6, "0805", 1, "c2"], [13.6, 5.2, "1206", 1, "c3"], [19.2, 5.2, "0603", 1, "r"], [21.0, 5.2, "0603", 1, "r"], [25.4, 11.6, "0603", 1, "r"],
    [27.5, 10.6, "0805", 1, "c"], [29.0, 7.8, "0603", 0, "c"], [27.6, 2.0, "0603", 0, "r"], [30.0, 4.8, "0603", 1, "r"], [31.4, 3.0, "0603", 1, "y"],
    [1.6, 4.0, "0805", 1, "c"], [3.4, 4.0, "0805", 1, "c2"], [22.3, 13.4, "0603", 0, "c"]];
  passives.forEach(([x, y, s, r, k]) => smd.add(x, y, s, r, k, true));
  const feats = groveFeatures([[0, 10, "notch"], [0, 30, "ear"], [1, 10, "notch"], [2, 10, "ear"], [2, 30, "notch"], [3, 10, "ear"]]);
  const holes = [[30, 0], [30, 20], [0, 10]];
  const board = groveBoard(kit, { w: W, h: H, features: feats, holes, palette: BLUE, pxmm: Q.pxmm * 1.1,
    draw: (art) => {
      const occ = new Occ(-3, -3, 43, 23, 0.3), tk = tracker(art, occ);
      occ.disc(5.9, 10.9, 5.2); occ.rect(15.0, 13.4, 21.6, 19.8); occ.rect(17.8, 7.6, 22.4, 12.0); occ.rect(15.2, 3.2, 18.2, 8.4); occ.rect(32.8, 4.6, 41, 16);
      for (const it of smd.items) occ.rect(...it.pad);
      tk.t([[8.6, 14.6], ...r45([11.0, 14.6], [15.6, 17.8])], 0.25, 0.18);
      tk.t([[9.8, 9.0], [12.3, 9.0], ...r45([14.0, 9.0], [17.8, 9.4])], 0.25, 0.18);
      tk.t([[21.0, 13.6], [21.0, 15.4]], 0.3, 0.18);
      tk.t([[22.5, 9.8], ...r45([24.2, 9.8], [26.2, 7.8]), [28.4, 7.8]], 0.3, 0.18);
      tk.t([[24.6, 8.2], ...r45([24.6, 6.4], [27.0, 4.0]), [27.0, 2.6]], 0.25, 0.16);
      tk.t([[31.8, 10.5], [34.0, 10.5]], 0.4, 0.2); tk.t([[30.0, 3.4], ...r45([31.4, 3.4], [34.0, 6.0]), [34.0, 7.3]], 0.25, 0.16);
      tk.t([[19.4, 16.0], [24.0, 16.0], ...r45([26.0, 16.0], [33.0, 13.2])], 0.25, 0.16);
      tk.t([[3.0, 6.0], [3.0, 7.8], [4.2, 9.0]], 0.4, 0.18); tk.t([[8.8, 6.4], ...r45([10.6, 6.4], [13.6, 3.4])], 0.25, 0.16);
      art.stroke(art.SUB, 0.8, (g) => g.rect(0, 0, W, H));
      sprinkle(art, occ, P.rng(3), [0.8, 0.8, 39, 19.2], 1.7, { tp: 3 });
      // gas sensor pads (six pins under the can) and silkscreen
      for (let a = 0; a < 6; a++) art.circle(art.TIN, 5.9 + Math.cos(a * Math.PI / 3) * 3.4, 10.9 + Math.sin(a * Math.PI / 3) * 3.4, 0.6);
      smd.paint(art);
      const sk = art.SILK, R = Math.PI;
      art.stroke(sk, 0.15, (g) => g.arc(5.9, 10.9, 5.35, Math.PI * 0.55, Math.PI * 1.45));
      [["U2", 1.9, 17.0, R], ["C9", 10.6, 15.7, Math.PI / 2], ["U4", 17.4, 12.9, R], ["R9", 24.3, 19.1, 0], ["R2", 12.3, 9.85, R], ["R7", 15.0, 13.1, R],
        ["C6", 10.9, 7.0, R], ["C7", 8.9, 7.0, R], ["C12", 13.7, 1.6, R], ["D2", 16.6, 2.2, R], ["R3", 19.2, 2.9, R], ["R4", 21.0, 2.9, R], ["U1", 24.1, 10.6, 0],
        ["R5", 25.4, 13.9, 0], ["C5", 27.6, 12.9, 0], ["Q1", 27.6, 6.9, 0], ["R1", 26.1, 0.9, R], ["R6", 29.9, 1.1, R], ["D1", 31.6, 5.3, 0], ["R8", 32.8, 3.0, Math.PI / 2],
        ["C1", 1.6, 1.4, R], ["C2", 3.5, 1.4, R], ["J1", 38.6, 2.2, R], ["L1", 20.1, 12.6, 0], ["C3", 29.0, 9.4, 0]].forEach(([t, x, y, rot]) => art.text(sk, t, x, y, 0.85, { rot, weight: 700 }));
      art.text(sk, "+", 32.2, 13.4, 1.1, { weight: 700 }); art.text(sk, "+", 13.6, 7.9, 1.0, { weight: 700 });
      art.box(sk, 15.1, 3.3, 3.2, 5.0, 0.13); art.box(sk, 22.6, 6.4, 3.0, 3.2, 0.13); art.box(sk, 26.4, 3.6, 2.6, 2.4, 0.13); art.box(sk, 28.6, 8.6, 3.4, 4.0, 0.13);
      art.box(sk, 32.9, 4.6, 8.0, 11.4, 0.14);
    },
    drawBottom: (bot) => { bot.text(bot.SILK, "Grove - Air Quality Sensor v1.3", 20, 10, 1.6, { weight: 700, rot: Math.PI }); },
  });
  board.geometry.translate(-W / 2, BASE, H / 2);
  body.add(board);

  // gas sensor can (MP503-style) with a thin dark base
  { const [x, z] = toLocal(5.9, 10.9); B.add("plastic", P.cylB(4.85, 0.6, x, TOP, z, 36), 0x2a2a2a); atlasCyl(B, kit, 4.7, 6.2, x, TOP + 0.6, z, "gasTop", "gasSide", 40); B.add("steel", new THREE.TorusGeometry(4.55, 0.22, 6, 40).rotateX(Math.PI / 2).translate(x, TOP + 6.8, z)); }
  chipAt(B, kit, "soic8", "lmv358", 18.3, 16.6, Math.PI, TOP, toLocal);
  { const [x, z] = toLocal(20.1, 9.8); atlasCyl(B, kit, 1.95, 2.8, x, TOP, z, "ind101", "ferrite", 24); }
  chipAt(B, kit, "sma", "sma", 16.7, 5.8, Math.PI / 2, TOP, toLocal);
  chipAt(B, kit, "sot23-5", "sot235", 24.1, 8.0, 0, TOP, toLocal);
  chipAt(B, kit, "sot23", "sot23", 27.7, 4.8, 0, TOP, toLocal);
  chipAt(B, kit, "tant", "tant", 30.3, 10.6, Math.PI / 2, TOP, toLocal, { side: "tantSide" });
  // J1: right-angle Grove socket, mouth facing +x (toward the Pi)
  const sock = P.groveSocketHorizontal(C.white), [jx, jz] = toLocal(37.2, 10.3), sm = P.mat4(jx, TOP, jz);
  B.add("plastic", sock.plastic.clone(), null, sm); B.add("tin", sock.pins.clone(), null, sm);
  const plug = new THREE.Object3D(); plug.applyMatrix4(new THREE.Matrix4().multiplyMatrices(sm, horizontalPlugMatrix())); body.add(plug);
  // nylon standoffs + screws at the three lugs
  for (const [X, Y] of holes) { const [x, z] = toLocal(X, Y); B.add("plastic", P.cylB(2.0, BASE, x, 0, z, 20), C.nylon); screw(B, x, TOP, z, "plastic", C.nylon, 0xb8b4a8, 0.9); }
  B.build(body, kit.mat);
  smd.build(body, kit, toLocal, TOP);
  return { part, plug };
}

/** Plug frame inside a horizontal socket: latch up (+y), cable out along +x, front near the back wall. */
function horizontalPlugMatrix() {
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)).setPosition(-2.6, 2.9, 0);
}

// ---- Grove Light Sensor v1.2 (20 × 20) on a small acrylic wedge, facing the sky ----
const LIGHT_TILT = THREE.MathUtils.degToRad(18);

function buildLight(kit) {
  const Q = kit.Q;
  const part = new THREE.Group(); part.name = "light";
  const body = new THREE.Group(); body.scale.setScalar(S); part.add(body);
  // wedge geometry: the tilted plate's front edge rests on the base plate, a back wall holds the rear edge
  const th = LIGHT_TILT, co = Math.cos(th), si = Math.sin(th), PT = 2.5, PY0 = -4.5, PZ = 12;
  const hC = PT - (PY0 * co - PZ * si), backY = hC + (PY0 * co + PZ * si), backZ = PY0 * si - PZ * co;
  const tilt = new THREE.Group(); tilt.position.set(0, hC, 0); tilt.rotation.x = th; body.add(tilt);
  const B = new P.Batch(), smd = new P.SmdSet(41, Q);
  const toLocal = (X, Y) => [X - 10, 10 - Y], TOP = 1.6;
  smd.add(13.0, 12.6, "0603", 0, "r", true); smd.add(17.6, 9.4, "0603", 1, "c", true); smd.add(17.6, 5.4, "0603", 1, "r", true);
  const feats = groveFeatures([[0, 10, "ear"], [1, 10, "notch"], [2, 10, "ear"], [3, 10, "notch"]]);
  const holes = [[10, 0], [10, 20]];
  const board = groveBoard(kit, { w: 20, h: 20, features: feats, holes, palette: BLUE, pxmm: Q.pxmm * 1.25,
    draw: (art) => {
      const occ = new Occ(-3, -3, 23, 23, 0.25), tk = tracker(art, occ);
      occ.rect(1.8, 4.4, 7.9, 16.6); occ.rect(10.4, 2.4, 16.0, 8.8); occ.disc(15.6, 16.0, 3.2);
      for (const it of smd.items) occ.rect(...it.pad);
      tk.t([[4.25, 13.5], [8.6, 13.5], ...r45([8.6, 13.5], [10.6, 11.5]), [10.6, 9.3]], 0.3, 0.18);
      tk.t([[4.25, 11.5], [7.9, 11.5], ...r45([8.4, 11.0], [8.4, 9.6])], 0.3, 0.18);
      tk.t([[4.25, 7.5], [7.6, 7.5], ...r45([7.6, 7.5], [10.6, 4.5])], 0.25, 0.16);
      tk.t([[14.33, 16.0], [14.33, 13.4]], 0.25, 0.16); tk.t([[16.87, 16.0], ...r45([16.87, 14.0], [17.6, 13.3]), [17.6, 10.4]], 0.25, 0.16);
      tk.t([[15.4, 2.6], [17.6, 2.6], [17.6, 4.4]], 0.25, 0.16);
      art.stroke(art.SUB, 0.8, (g) => g.rect(0, 0, 20, 20));
      sprinkle(art, occ, P.rng(9), [0.8, 0.8, 19.2, 19.2], 1.6);
      [14.33, 16.87].forEach((x) => art.plated(x, 16.0, 0.45, 0.8, art.TIN));
      smd.paint(art);
      const sk = art.SILK;
      ["GND", "VCC", "NC", "SIG"].forEach((t, i) => art.text(sk, t, 8.1, 13.5 - i * 2, 0.95, { align: "left", weight: 700 }));
      art.line(sk, 0.16, [[7.6, 16.4], [7.6, 4.6], [1.6, 4.6]]); art.line(sk, 0.16, [[1.6, 16.4], [7.6, 16.4]]);
      art.text(sk, "R1", 13.0, 14.0, 0.85, { weight: 700 }); art.text(sk, "LIGHT", 15.6, 12.4, 0.9, { weight: 700 });
      art.stroke(sk, 0.16, (g) => g.arc(15.6, 16.0, 3.0, Math.PI * 1.05, Math.PI * 1.95));
      art.text(sk, "U1", 13.2, 1.4, 0.8, { weight: 700 }); art.text(sk, "C1", 19.0, 9.4, 0.7, { rot: Math.PI / 2 });
    },
    drawBottom: (bot) => {
      [7.5, 9.5, 11.5, 13.5].forEach((y) => bot.circle(bot.TIN, 4.25, y, 0.65));
      [14.33, 16.87].forEach((x) => bot.circle(bot.TIN, x, 16.0, 0.7));
      bot.text(bot.SILK, "Grove - Light Sensor", 10, 9.0, 1.45, { weight: 700 }); bot.text(bot.SILK, "v1.2", 10, 6.6, 1.3, { weight: 700 });
    },
  });
  board.geometry.translate(-10, 0, 10);
  tilt.add(board);

  chipAt(B, kit, "soic8", "lm358", 13.2, 5.6, Math.PI, TOP, toLocal);
  const sock = P.groveSocketVertical(C.white), [sx, sz] = toLocal(4.6, 10.5), sm = P.mat4(sx, TOP, sz);
  B.add("plastic", sock.plastic.clone(), null, sm); B.add("tin", sock.pins.clone(), null, sm);
  const plug = new THREE.Object3D(); plug.applyMatrix4(P.mat4(sx, TOP + 1.45, sz)); tilt.add(plug);
  // LS06-S phototransistor: clear epoxy dome on two legs; its leadframe and die show through
  const [lx, lz] = toLocal(15.6, 16.0), y0 = TOP + 3.2;
  for (const dx of [-1.27, 1.27]) { B.add("tin", P.cylB(0.24, 3.2 + 2.4, lx + dx, TOP, lz, 8)); B.add("tin", P.cylB(0.3, 0.9, lx + dx, -0.9, lz, 8, 0.24)); }
  B.add("steel", P.cylB(0.55, 0.35, lx - 1.27, y0 + 2.4, lz, 12));
  B.add("plastic", P.boxB(0.6, 0.18, 0.6, lx - 1.27, y0 + 2.75, lz), 0x1a1d24);
  B.add("tin", P.box(lx - 1.27, y0 + 2.86, lz - 0.03, lx + 1.27, y0 + 3.3, lz + 0.03));
  const dome = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [2.85, 0], [2.85, 0.8], [2.5, 0.86], [2.5, 4.35], [2.46, 4.72], [2.25, 5.02], [1.7, 5.2], [0.85, 5.28], [0, 5.3]].map(([a, b]) => new THREE.Vector2(a, b)), 40).translate(lx, y0, lz), kit.mat.epoxy);
  dome.receiveShadow = true; dome.renderOrder = 2; tilt.add(dome);
  // nylon standoffs between the wedge and the board lugs
  for (const [X, Y] of holes) { const [x, z] = toLocal(X, Y); B.add("plastic", P.cylB(1.8, 2.0, x, -2.0, z, 18), C.nylon); screw(B, x, TOP, z, "plastic", C.nylon, 0xb8b4a8, 0.8); }
  B.build(tilt, kit.mat);
  smd.build(tilt, kit, toLocal, TOP);

  // acrylic wedge: base plate, back wall, tilted plate
  const stand = new THREE.Mesh(P.mergeAll([P.box(-12.5, 0, backZ - 2.5, 12.5, PT, PZ * co + 1), P.box(-11.5, PT, backZ - 2.5, 11.5, backY + 0.3, backZ)]), kit.mat.acrylic);
  stand.receiveShadow = true; body.add(stand);
  const plate = new THREE.Mesh(P.box(-11.5, PY0, -PZ, 11.5, -2, PZ), kit.mat.acrylic); plate.receiveShadow = true; tilt.add(plate);
  return { part, plug, tilt };
}

// ---- Grove LCD RGB Backlight (80 × 36 board, 16×2 module), standing on an acrylic stand facing the room ----
const LCD_W = 64.5, LCD_H = 16.4; // viewing window (mm)

function buildLCD(kit) {
  const Q = kit.Q;
  const part = new THREE.Group(); part.name = "lcd";
  const body = new THREE.Group(); body.scale.setScalar(S); part.add(body);
  const tilt = new THREE.Group(); tilt.position.set(0, 25.4, 0); tilt.rotation.set(THREE.MathUtils.degToRad(-75), Math.PI, 0); body.add(tilt);
  const B = new P.Batch(), smd = new P.SmdSet(51, Q);
  const toLocal = (X, Y) => [X - 40, 18 - Y], TOP = 1.6, MOD = [4.4, 7.3, 75.6, 33.3];
  smd.add(33.5, 5.0, "0603", 0, "r", true); smd.add(33.5, 3.4, "0603", 0, "r", true); smd.add(36.4, 4.2, "0603", 1, "c", true);
  const feats = groveFeatures([[0, 10, "ear"], [0, 30, "notch"], [0, 50, "notch"], [0, 70, "ear"], [1, 18, "ear"], [2, 10, "ear"], [2, 30, "notch"], [2, 50, "notch"], [2, 70, "ear"], [3, 18, "ear"]]);
  const holes = [[10, 0], [70, 0], [80, 18], [70, 36], [10, 36], [0, 18]];
  const board = groveBoard(kit, { w: 80, h: 36, features: feats, holes, palette: BLUE, pxmm: Math.max(7, Q.pxmm * 0.55),
    draw: (art) => {
      const occ = new Occ(-3, -3, 83, 39, 0.4), tk = tracker(art, occ);
      occ.rect(MOD[0], MOD[1], MOD[2], MOD[3]); occ.rect(15.6, -0.6, 26.4, 7.2);
      for (const it of smd.items) occ.rect(...it.pad);
      for (let i = 0; i < 4; i++) tk.t([[17.5 + i * 2, 6.6], [17.5 + i * 2, 7.8]], 0.3, 0.18);
      tk.t([[27.0, 5.8], [31.0, 5.8], [32.6, 4.2], [37.0, 4.2]], 0.3, 0.18);
      art.stroke(art.SUB, 0.8, (g) => g.rect(0, 0, 80, 36));
      sprinkle(art, occ, P.rng(19), [1, 1, 79, 35], 2.2);
      smd.paint(art);
      const sk = art.SILK;
      ["GND", "VCC", "SDA", "SCL"].forEach((t, i) => art.text(sk, t, 27.0, 6.6 - i * 1.45, 1.0, { align: "left", weight: 700 }));
      art.text(sk, "J1", 13.8, 2.4, 1.1, { weight: 700 });
      art.text(sk, "Grove-LCD RGB Backlight", 56.0, 3.6, 1.55, { weight: 700 });
      art.text(sk, "V2.0", 75.0, 5.6, 1.0, { weight: 700 });
    },
    drawBottom: (bot) => { bot.text(bot.SILK, "LCD RGB Backlight", 40, 20, 2.4, { weight: 700, rot: 0 }); bot.rect({ col: "#111214" }, 30, 10, 6, 6); },
  });
  board.geometry.translate(-40, 0, 18);
  tilt.add(board);

  // module body: black bezel with the window, raised lips, glass recessed inside
  const [mx, mz] = toLocal((MOD[0] + MOD[2]) / 2, (MOD[1] + MOD[3]) / 2), MW = MOD[2] - MOD[0], MH = MOD[3] - MOD[1];
  B.add("plastic", P.boxB(MW, 6.6, MH, mx, TOP, mz), C.bezel);
  {
    const fr = new THREE.Shape(); fr.moveTo(-MW / 2, -MH / 2); fr.lineTo(MW / 2, -MH / 2); fr.lineTo(MW / 2, MH / 2); fr.lineTo(-MW / 2, MH / 2); fr.closePath();
    const hole = new THREE.Path(); hole.moveTo(-LCD_W / 2, -LCD_H / 2); hole.lineTo(-LCD_W / 2, LCD_H / 2); hole.lineTo(LCD_W / 2, LCD_H / 2); hole.lineTo(LCD_W / 2, -LCD_H / 2); hole.closePath();
    fr.holes.push(hole);
    B.add("plastic", new THREE.ExtrudeGeometry(fr, { depth: 1.6, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(mx, TOP + 6.6, mz), C.bezel);
    for (const s of [-1, 1]) {
      B.add("plastic", P.boxB(MW - 4, 0.55, 0.7, mx, TOP + 8.2, mz + s * (LCD_H / 2 + 1.1)), 0x1b1c1e);
      B.add("plastic", P.boxB(MW - 4, 0.55, 0.7, mx, TOP + 8.2, mz + s * (LCD_H / 2 + 2.6)), 0x1b1c1e);
    }
  }
  const sock = P.groveSocketHorizontal(C.white), [jx, jz] = toLocal(21.0, 3.3), sm = P.mat4(jx, TOP, jz, -Math.PI / 2);
  B.add("plastic", sock.plastic.clone(), null, sm); B.add("tin", sock.pins.clone(), null, sm);
  const plug = new THREE.Object3D(); plug.applyMatrix4(new THREE.Matrix4().multiplyMatrices(sm, horizontalPlugMatrix())); tilt.add(plug);
  for (const [X, Y] of [[10, 0], [70, 0], [10, 36], [70, 36]]) { const [x, z] = toLocal(X, Y); B.add("plastic", P.cylB(1.9, 2.0, x, -2.0, z, 16), C.nylon); screw(B, x, TOP, z, "plastic", C.nylon, 0xb8b4a8, 0.85); }
  B.build(tilt, kit.mat);
  smd.build(tilt, kit, toLocal, TOP);

  // the screen: dot-matrix canvas, lit from behind (emissive) under a glossy glass face
  const W = Q.low ? 640 : 1290, Hc = Math.round(W * LCD_H / LCD_W);
  const canvas = P.makeCanvas(W, Hc), tex = P.canvasTex(canvas, true, Q.aniso);
  const screenMat = Q.physical
    ? new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 })
    : new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(LCD_W, LCD_H).rotateX(-Math.PI / 2).translate(mx, TOP + 7.4, mz), screenMat);
  screen.receiveShadow = true; tilt.add(screen);
  // backlight bleeding out where the bezel meets the board, and a faint halo round the window
  const leakMat = new THREE.MeshBasicMaterial({ color: 0x3c78ff, transparent: true, opacity: 0.9, toneMapped: true });
  const leak = new THREE.Mesh(P.mergeAll([P.box(mx - MW / 2 - 0.12, TOP, mz - MH / 2 - 0.12, mx + MW / 2 + 0.12, TOP + 0.32, mz - MH / 2 + 0.2),
    P.box(mx - MW / 2 - 0.12, TOP, mz + MH / 2 - 0.2, mx + MW / 2 + 0.12, TOP + 0.32, mz + MH / 2 + 0.12),
    P.box(mx - MW / 2 - 0.12, TOP, mz - MH / 2, mx - MW / 2 + 0.2, TOP + 0.32, mz + MH / 2),
    P.box(mx + MW / 2 - 0.2, TOP, mz - MH / 2, mx + MW / 2 + 0.12, TOP + 0.32, mz + MH / 2)]), leakMat);
  tilt.add(leak);
  const haloTex = P.canvasTex(haloCanvas(), true, 1);
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, color: 0x3c78ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(LCD_W + 7, LCD_H + 7).rotateX(-Math.PI / 2).translate(mx, TOP + 8.25, mz), haloMat);
  halo.renderOrder = 3; tilt.add(halo);

  // acrylic stand: base plate + two side brackets behind the board
  const bracket = new THREE.Shape([[-3.93, 3], [7.05, 44], [10.0, 44], [14.0, 3]].map(([a, b]) => new THREE.Vector2(a, b)));
  const brk = (x) => new THREE.ExtrudeGeometry(bracket, { depth: 3, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(x + 1.5, 0, 0);
  const stand = new THREE.Mesh(P.mergeAll([P.box(-33, 0, -6, 33, 3, 15), brk(-30), brk(30)]), kit.mat.acrylic);
  stand.receiveShadow = true; body.add(stand);
  return { part, plug, canvas, tex, screenMat, leakMat, haloMat };
}

/** Soft rectangular glow with a transparent centre (the bright window itself is the screen). */
function haloCanvas() {
  const w = 256, h = 96, c = P.makeCanvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h);
  const iw = w * (LCD_W / (LCD_W + 7)) / 2, ih = h * (LCD_H / (LCD_H + 7)) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.max(0, Math.abs(x - w / 2) - iw), dy = Math.max(0, Math.abs(y - h / 2) - ih), d = Math.hypot(dx, dy * (w / h) * (LCD_H + 7) / (LCD_W + 7));
    const inside = Math.abs(x - w / 2) < iw && Math.abs(y - h / 2) < ih;
    const a = inside ? 0 : Math.exp(-d / 4.5) * 0.9;
    const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---- small round speaker ----
function buildSpeaker(kit) {
  const part = new THREE.Group(); part.name = "speaker";
  const body = new THREE.Group(); body.scale.setScalar(S); part.add(body);
  const B = new P.Batch();
  const prof = [[0, 0], [18.6, 0], [19.6, 0.35], [20, 1.3], [20, 10.2], [19.75, 11.1], [19.1, 11.75], [18.2, 12.0], [17.6, 11.95], [17.5, 11.4], [0, 11.4]].map(([a, b]) => new THREE.Vector2(a, b));
  B.add("plastic", new THREE.LatheGeometry(prof, 64), C.speaker);
  const grille = new THREE.CircleGeometry(17.5, 64).rotateX(-Math.PI / 2).translate(0, 11.45, 0);
  P.atlasUV(grille, kit.cell("grille")); B.add("atlas", grille);
  B.add("steel", new THREE.TorusGeometry(17.75, 0.32, 8, 72).rotateX(Math.PI / 2).translate(0, 11.55, 0));
  B.add("plastic", P.cylZ(2.2, 3.2, 0, 4.2, 0, 16).rotateY(-(Math.PI / 2 - 0.35)).translate(Math.cos(Math.PI + 0.35) * 19.0, 0, Math.sin(0.35) * 19.0), 0x101010);
  for (const a of [0.6, 2.2, 3.8, 5.4]) B.add("plastic", P.cylB(2.4, 0.6, Math.cos(a) * 14, -0.6, Math.sin(a) * 14, 14), 0x0c0c0c);
  B.build(body, kit.mat);
  return { part, gland: new THREE.Vector3(Math.cos(Math.PI + 0.35) * 22.0, 4.2, Math.sin(0.35) * 22.0) };
}

// ---------------------------------------------------------------------------------------------------
// cables

/** World→root-mm transform of an Object3D (root is still at the origin when this runs). */
function frameMM(o) {
  o.updateWorldMatrix(true, false);
  const m = new THREE.Matrix4().makeScale(1000, 1000, 1000).multiply(o.matrixWorld);
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3(); m.extractBasis(x, y, z);
  return { m, p, x: x.normalize(), y: y.normalize(), z: z.normalize() };
}

function buildCables(kit, ends, audio) {
  const group = new THREE.Group(); group.name = "cables";
  const body = new THREE.Group(); body.scale.setScalar(S); group.add(body);
  const geos = [];
  const plugGeo = P.grovePlug(C.plug);
  for (const { a, b, via } of ends) {
    const A = frameMM(a), Bf = frameMM(b);
    [A, Bf].forEach((f) => geos.push(applyMM(plugGeo.clone(), f.m)));
    const pa = A.p.clone().addScaledVector(A.y, 9.3), pb = Bf.p.clone().addScaledVector(Bf.y, 9.3);
    const pts = [pa, pa.clone().addScaledVector(A.y, 4), ...via.map((v) => new THREE.Vector3(...v)), pb.clone().addScaledVector(Bf.y, 4), pb];
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    const samples = curve.getSpacedPoints(Math.max(40, Math.round(curve.getLength() / 2.2)));
    geos.push(P.ribbon(samples, A.z, A.z.dot(Bf.z) < 0 ? Bf.z.clone().negate() : Bf.z));
  }
  if (audio) {
    // 3.5 mm plug in the Pi's A/V jack, lead running round to the speaker
    const jack = new THREE.Vector3(px(54.0), PI_TOP + 3.0, pz(-2.5));
    geos.push(P.paint(P.cylZ(1.75, 1.2, jack.x, jack.y, jack.z, 16), 0xc9ccd0));
    geos.push(P.paint(new THREE.LatheGeometry([[0, 0], [3.1, 0], [3.3, 1], [3.3, 10.5], [2.6, 12.5], [1.6, 15.5], [0, 15.5]].map(([a, b]) => new THREE.Vector2(a, b)), 24).rotateX(Math.PI / 2).translate(jack.x, jack.y, jack.z + 1.2), 0x141414));
    const start = new THREE.Vector3(jack.x, jack.y, jack.z + 16.5);
    geos.push(P.roundCable([start, ...audio.via.map((v) => new THREE.Vector3(...v)), audio.end], 1.15, 0x141414));
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, transparent: false });
  const mesh = new THREE.Mesh(P.mergeAll(geos), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  body.add(mesh);
  return { group, mat };
}

function applyMM(geo, m) { geo.applyMatrix4(m); return geo; }

// ---------------------------------------------------------------------------------------------------
// LCD rendering: 16×2 characters of 5×8 dots on the RGB backlight

function drawLCD(canvas, line1, line2, rgb) {
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, s = W / LCD_W;
  const [r, gg, b] = rgb.map((v) => Math.max(14, Math.min(255, v)));
  // backlight: brighter toward the LED end, a slightly brighter rim just inside the bezel, darker corners
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, `rgb(${Math.min(255, r * 1.08) | 0},${Math.min(255, gg * 1.08) | 0},${Math.min(255, b * 1.08) | 0})`);
  grad.addColorStop(0.5, `rgb(${r},${gg},${b})`);
  grad.addColorStop(1, `rgb(${r * 0.86 | 0},${gg * 0.86 | 0},${b * 0.86 | 0})`);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // STN film tint and faint pixel grid
  g.fillStyle = "rgba(200,215,170,0.07)"; g.fillRect(0, 0, W, H);
  const rim = g.createLinearGradient(0, 0, 0, H);
  rim.addColorStop(0, "rgba(255,255,255,0.10)"); rim.addColorStop(0.07, "rgba(255,255,255,0)"); rim.addColorStop(0.93, "rgba(255,255,255,0)"); rim.addColorStop(1, "rgba(255,255,255,0.08)");
  g.fillStyle = rim; g.fillRect(0, 0, W, H);
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.22)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  // characters (HD44780 geometry: dot 0.55 × 0.65 mm, pitch 0.6 × 0.7, cell pitch 3.55 × 5.95)
  const ox = (LCD_W - 56.2) / 2, oy = (LCD_H - 11.5) / 2, dw = 0.55 * s, dh = 0.65 * s;
  [line1, line2].forEach((line, row) => {
    const text = String(line || "").padEnd(16).slice(0, 16);
    for (let i = 0; i < 16; i++) {
      const dots = glyphOrNull(text[i]);
      const cx = (ox + i * 3.55) * s, cy = (oy + row * 5.95) * s;
      for (let k = 0; k < 40; k++) {
        const on = dots && dots[k];
        g.fillStyle = on ? "rgba(14,18,30,0.9)" : "rgba(0,0,0,0.055)";
        g.fillRect(cx + (k % 5) * 0.6 * s, cy + Math.floor(k / 5) * 0.7 * s, dw, dh);
      }
    }
  });
}
function glyphOrNull(ch) { return ch === " " ? null : P.glyph(ch); }

// ---------------------------------------------------------------------------------------------------

export function createDevice({ tier = "high" } = {}) {
  const Q = P.quality(tier);
  const kit = createKit(Q);
  const root = new THREE.Group(); root.name = "device";
  const parts = {};

  const pi = buildPi(kit); parts.pi = pi.part;
  const hat = buildHat(kit); parts.hat = hat.part;
  const air = buildAir(kit); parts.air = air.part; air.part.position.set(-0.078, 0, 0.004);
  const light = buildLight(kit); parts.light = light.part; light.part.position.set(0.064, 0, 0.036);
  const lcd = buildLCD(kit); parts.lcd = lcd.part; lcd.part.position.set(0.004, 0, -0.045);
  const spk = buildSpeaker(kit); parts.speaker = spk.part; spk.part.position.set(0.082, 0, -0.03);
  Object.values(parts).forEach((p) => root.add(p));
  root.updateMatrixWorld(true);

  // Grove cables (A0 → air, A2 → light, I2C → LCD) and the speaker's audio lead
  const spkGland = spk.gland.clone().add(new THREE.Vector3(82, 0, -30));
  const cables = buildCables(kit, [
    { a: hat.plugAt.A0, b: air.plug, via: [[6, 41, -11], [-14, 44, -6], [-36, 38, -1], [-49, 21, 2.5]] },
    { a: hat.plugAt.A2, b: light.plug, via: [[23, 39, -7], [39, 38.5, 10], [53, 33, 31]] },
    { a: hat.plugAt.I2C, b: lcd.plug, via: [[23, 1.6, -58], [23, 2.2, -50], [22, 5.6, -40], [18, 12, -31], [10, 36, -22], [0, 42, 2]] },
  ], { via: [[11.5, 8.5, 52], [17, 1.4, 58], [40, 1.4, 56], [48.5, 1.4, 47], [48.5, 1.4, 4], [50, 1.4, -16], [56.5, 2.2, -21]], end: spkGland });
  parts.cables = cables.group; root.add(cables.group);

  // exploded-view offsets (metres) — same directions as before
  const explode = { pi: [0, 0, 0], hat: [0, 0.05, 0], air: [-0.05, 0.035, -0.02], light: [0.055, 0.05, 0.03], lcd: [0, 0.065, -0.06], speaker: [0.05, 0.02, -0.04] };
  const home = {}; Object.keys(explode).forEach((k) => (home[k] = parts[k].position.clone()));

  // reflections: borrow the scene's environment map and scale it per material (see createKit)
  const envList = [...kit.env, [lcd.screenMat, 1.5]];
  root.traverse((o) => { if (o.isMesh) { for (const m of [].concat(o.material)) if (m.isMeshPhysicalMaterial && m.clearcoat > 0 && !envList.some(([x]) => x === m)) envList.push([m, 2.4]); } });
  pi.board.frustumCulled = false;
  pi.board.onBeforeRender = (renderer, scene) => {
    if (!scene || !scene.environment) return;
    const base = scene.environmentIntensity ?? 1;
    for (const [m, k] of envList) { if (m.envMap !== scene.environment) m.envMap = scene.environment; m.envMapIntensity = base * k; }
  };

  // ACT LED: SD-card activity flicker in bursts
  let ticked = -1;
  function act(t) {
    const k = Math.floor(t * 11), h = Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1;
    const burst = Math.sin(t * 0.83) + Math.sin(t * 2.1 + 1.3) > 0.55;
    pi.actMat.emissiveIntensity = burst && h > 0.4 ? 3.4 : 0.06;
  }
  function tick(time) { ticked = performance.now(); act(time); }

  let lcdKey = "";
  function setLCD(line1, line2, rgb = [60, 120, 255]) {
    if (performance.now() - ticked > 500) act(performance.now() / 1000);
    const key = line1 + "|" + line2 + "|" + rgb.join(",");
    if (key === lcdKey) return; lcdKey = key;
    drawLCD(lcd.canvas, line1, line2, rgb);
    lcd.tex.needsUpdate = true;
    const c = new THREE.Color().setRGB(...rgb.map((v) => Math.max(14, v) / 255), THREE.SRGBColorSpace);
    lcd.leakMat.color.copy(c).multiplyScalar(1.6); lcd.haloMat.color.copy(c);
  }
  setLCD("SkyWindow", "Warming up...", [60, 120, 255]);

  /** e: 0 assembled → 1 exploded; cables fade out as parts separate */
  function setExplode(e) {
    Object.keys(explode).forEach((k) => {
      const o = explode[k];
      parts[k].position.set(home[k].x + o[0] * e, home[k].y + o[1] * e, home[k].z + o[2] * e);
    });
    const fade = 1 - Math.min(1, e * 1.6);
    cables.mat.transparent = fade < 0.999; cables.mat.opacity = fade; cables.mat.depthWrite = fade > 0.5;
    cables.group.visible = e < 0.62;
  }

  // world-space anchor helpers for labels and camera framing
  function anchor(name) { return parts[name].getWorldPosition(new THREE.Vector3()); }

  root.traverse((o) => {
    if (!o.isMesh) return;
    const clear = [].concat(o.material).some((m) => m === kit.mat.acrylic || m === kit.mat.epoxy || m.blending === THREE.AdditiveBlending || m.isMeshBasicMaterial);
    o.castShadow = !clear; o.receiveShadow = true;
  });
  return { root, parts, setLCD, setExplode, anchor, speaker: parts.speaker, tick };
}
