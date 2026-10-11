// The classroom's window wall, modelled in code (metres). Outside is +z, the room is −z.
// Three double-hung sash windows sit in a 0.3 m wall: red brick outside (with a stone sill and lintel,
// a concrete plinth, the roof coping, a gutter and a downspout), painted block inside, a cast-iron
// radiator and venetian blinds under and over each window. The hero window is the middle one: its
// opening runs x −0.6..0.6, y 0.92..2.72 and its lower sash slides up on the inner track.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const W = 1.2, SILL = 0.92, HEAD = 2.72;
/** interior of the classroom; the floor is at 0 so the sill sits at a real 0.92 m */
export const ROOM = { x0: -4.5, x1: 4.5, z0: -8.6, z1: -0.15, floor: 0, ceil: 3.0, ground: -0.6, eave: 4.1 };
/** windows of this classroom (x centre); blind = fraction of the opening the blind covers, tilt in radians */
export const WINDOWS = [{ x: 0, main: true, blind: 0 }, { x: -2.5, blind: 0.5, tilt: 0.75 }, { x: 2.5, blind: 0.16, tilt: 0.2 }];
const NEIGHBOURS = [-9.8, -7.3, 7.3, 9.8]; // the classrooms next door (facade only)
const FACADE = [-14, 14];

// ---------- geometry helpers (shared with classroom.js) ----------

/** Box-mapped UVs in world metres, so tiling textures keep their real size (texture.repeat = 1 / tile size). */
export function worldUV(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ax >= ay && ax >= az) uv.setXY(i, -p.getZ(i) * Math.sign(nx), p.getY(i));
    else if (ay >= az) uv.setXY(i, p.getX(i), -p.getZ(i) * Math.sign(ny));
    else uv.setXY(i, p.getX(i) * Math.sign(nz), p.getY(i));
  }
  uv.needsUpdate = true;
  return g;
}

/** A box placed in world space. o: { rx, ry, rz, r (rounded radius), uv: world UVs (default true) } */
export function box(w, h, d, x = 0, y = 0, z = 0, o = {}) {
  const g = o.r ? new RoundedBoxGeometry(w, h, d, 2, o.r) : new THREE.BoxGeometry(w, h, d);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  g.translate(x, y, z);
  if (o.uv !== false) worldUV(g);
  return g;
}

/** Merge geometries with mixed indexing / attribute sets into one (position, normal, uv[, color]). */
export function merge(list) {
  const keep = ["position", "normal", "uv"];
  const withColor = list.some((g) => g.attributes.color);
  if (withColor) keep.push("color");
  const anyNon = list.some((g) => !g.index);
  const prepared = list.map((g0) => {
    let g = anyNon && g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (withColor && !g.attributes.color) g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    return g;
  });
  return mergeGeometries(prepared, false);
}

/** Paint a vertex colour over a whole geometry (multiplied with the material / instance colour). */
export function tint(g, c) {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}

/** Wall slab x0..x1 × y0..y1 × z0..z1 with rectangular holes (all holes share the slab's depth). */
function slab(x0, x1, y0, y1, z0, z1, holes) {
  const out = [], d = z1 - z0, zc = (z0 + z1) / 2;
  const hs = holes.filter((h) => h.x1 > x0 && h.x0 < x1).sort((a, b) => a.x0 - b.x0);
  let cx = x0;
  for (const h of hs) {
    if (h.x0 > cx) out.push(box(h.x0 - cx, y1 - y0, d, (cx + h.x0) / 2, (y0 + y1) / 2, zc));
    const w = h.x1 - h.x0, xc = (h.x0 + h.x1) / 2;
    if (h.y0 > y0) out.push(box(w, h.y0 - y0, d, xc, (y0 + h.y0) / 2, zc));
    if (h.y1 < y1) out.push(box(w, y1 - h.y1, d, xc, (h.y1 + y1) / 2, zc));
    cx = h.x1;
  }
  if (cx < x1) out.push(box(x1 - cx, y1 - y0, d, (cx + x1) / 2, (y0 + y1) / 2, zc));
  return out;
}

// ---------- the window wall ----------

export function createSashWindow({ tier, kit }) {
  const root = new THREE.Group();
  const M = kit.mat;
  const high = tier === "high", low = tier === "low";
  const add = (geo, mat, { cast = true, receive = true, interior = false } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; root.add(m);
    if (interior) kit.patchInterior(mat);
    return m;
  };

  // --- wall: brick skin outside (z 0.03..0.15), painted block inside (z −0.15..0.03) ---
  const holeX = (x) => ({ x0: x - W / 2, x1: x + W / 2 });
  const outerHoles = [...WINDOWS.map((w) => w.x), ...NEIGHBOURS].map((x) => ({ ...holeX(x), y0: SILL - 0.06, y1: HEAD + 0.2 }));
  const brick = slab(FACADE[0], FACADE[1], -0.25, ROOM.eave, 0.03, 0.15, outerHoles);
  // outside this classroom the wall is solid brick all the way through
  brick.push(...slab(FACADE[0], ROOM.x0 - 0.15, -0.25, ROOM.eave, -0.15, 0.03, outerHoles.filter((h) => h.x1 < ROOM.x0)));
  brick.push(...slab(ROOM.x1 + 0.15, FACADE[1], -0.25, ROOM.eave, -0.15, 0.03, outerHoles.filter((h) => h.x0 > ROOM.x1)));
  add(merge(brick), M.brick);
  const innerHoles = WINDOWS.map((w) => ({ ...holeX(w.x), y0: SILL, y1: HEAD }));
  add(merge(slab(ROOM.x0 - 0.15, ROOM.x1 + 0.15, ROOM.floor - 0.02, ROOM.eave, -0.15, 0.03, innerHoles)), M.wall, { interior: true });

  // plinth, coping, gutter, downspout
  add(box(FACADE[1] - FACADE[0], 0.36, 0.33, 0, -0.43, 0.015), M.concrete);
  add(merge([
    box(FACADE[1] - FACADE[0], 0.24, 0.52, 0, ROOM.eave + 0.12, 0.1, { r: 0.008, uv: false }),
    box(FACADE[1] - FACADE[0], 0.03, 0.56, 0, ROOM.eave + 0.255, 0.1, { uv: false }),
  ]), M.coping);
  const gutterGeo = new THREE.CylinderGeometry(0.075, 0.075, FACADE[1] - FACADE[0], 20, 1, true, Math.PI, Math.PI).rotateZ(Math.PI / 2);
  gutterGeo.translate(0, ROOM.eave + 0.04, 0.44);
  const gutterLip = new THREE.CylinderGeometry(0.009, 0.009, FACADE[1] - FACADE[0], 8).rotateZ(Math.PI / 2).translate(0, ROOM.eave + 0.04, 0.515);
  const dsX = 4.85;
  const spout = [
    box(0.1, 4.13, 0.075, dsX, 1.665, 0.195, { r: 0.012, uv: false }),          // the long run down the wall
    box(0.1, 0.32, 0.075, dsX, 4.0, 0.33, { rx: -0.95, r: 0.012, uv: false }),        // offset from the gutter outlet
    box(0.1, 0.075, 0.3, dsX, -0.44, 0.34, { r: 0.012, uv: false }),                   // kick-out at the bottom
    ...[0.6, 2.2, 3.5].map((y) => box(0.13, 0.025, 0.09, dsX, y, 0.19, { uv: false })), // straps
  ];
  add(merge([gutterGeo, gutterLip, ...spout]), M.gutter);
  add(box(0.32, 0.05, 0.5, dsX, -0.575, 0.62), M.concrete); // splash block

  // --- windows ---
  const IW = W - 0.14, SH = 0.852, Y0 = SILL + 0.06, Y1 = HEAD - 0.08;
  const frameParts = [], glassParts = [], stoneParts = [], innerTrim = [], darkParts = [];
  function frame(x, exterior) {
    frameParts.push(
      box(0.07, HEAD - SILL, 0.16, x - W / 2 + 0.035, (SILL + HEAD) / 2, 0, { uv: false }),
      box(0.07, HEAD - SILL, 0.16, x + W / 2 - 0.035, (SILL + HEAD) / 2, 0, { uv: false }),
      box(W, 0.08, 0.16, x, HEAD - 0.04, 0, { uv: false }),
      box(W - 0.01, 0.06, 0.2, x, SILL + 0.03, 0.02, { rx: 0.06, uv: false }),                 // frame sill, pitched to shed rain
      box(0.012, HEAD - SILL - 0.14, 0.018, x - IW / 2 + 0.006, (SILL + HEAD) / 2, 0.012, { uv: false }), // parting beads
      box(0.012, HEAD - SILL - 0.14, 0.018, x + IW / 2 - 0.006, (SILL + HEAD) / 2, 0.012, { uv: false }),
    );
    if (exterior) {
      // brick mould around the outside of the frame
      frameParts.push(
        box(0.045, HEAD - SILL + 0.02, 0.03, x - W / 2 + 0.0225, (SILL + HEAD) / 2 + 0.01, 0.095, { r: 0.006, uv: false }),
        box(0.045, HEAD - SILL + 0.02, 0.03, x + W / 2 - 0.0225, (SILL + HEAD) / 2 + 0.01, 0.095, { r: 0.006, uv: false }),
        box(W, 0.045, 0.03, x, HEAD - 0.0225, 0.095, { r: 0.006, uv: false }),
      );
      stoneParts.push(
        box(W + 0.28, 0.065, 0.3, x, SILL - 0.03, 0.19, { rx: 0.07 }),     // stone sill with horns, sloping outwards
        box(W + 0.3, 0.2, 0.14, x, HEAD + 0.1, 0.1),                     // stone lintel
      );
    }
  }
  /** one sash as geometry lists in local space (origin at the bottom centre); meeting = rail at the top */
  function sashGeos(meetingTop, cx, oy, oz) {
    const stile = 0.05, top = meetingTop ? 0.045 : 0.06, bottom = meetingTop ? 0.07 : 0.045;
    const r = 0.004, f = [], gl = [];
    f.push(box(stile, SH, 0.045, cx - IW / 2 + stile / 2, oy + SH / 2, oz, { r, uv: false }));
    f.push(box(stile, SH, 0.045, cx + IW / 2 - stile / 2, oy + SH / 2, oz, { r, uv: false }));
    f.push(box(IW, top, 0.045, cx, oy + SH - top / 2, oz, { r, uv: false }));
    f.push(box(IW, bottom, 0.045, cx, oy + bottom / 2, oz, { r, uv: false }));
    const innerH = SH - top - bottom, cy = oy + bottom + innerH / 2;
    f.push(box(0.022, innerH, 0.03, cx, cy, oz, { r: 0.003, uv: false }));               // glazing bars: 2-over-2
    f.push(box(IW - 2 * stile, 0.022, 0.03, cx, cy, oz, { r: 0.003, uv: false }));
    gl.push(new THREE.PlaneGeometry(IW - 2 * stile + 0.01, innerH + 0.01).translate(cx, cy, oz));
    return { f, gl };
  }

  let lowerSash = null, raise = 0;
  const allWindows = [...WINDOWS.map((w) => ({ ...w, room: true })), ...NEIGHBOURS.map((x) => ({ x, room: false }))];
  for (const w of allWindows) {
    frame(w.x, true);
    const up = sashGeos(false, w.x, Y1 - SH, 0.035);
    frameParts.push(...up.f); glassParts.push(...up.gl);
    if (w.main) {
      const lo = sashGeos(true, 0, 0, 0);
      const g = new THREE.Group();
      const f = new THREE.Mesh(merge(lo.f), M.trim); f.castShadow = f.receiveShadow = true; g.add(f);
      const pane = new THREE.Mesh(lo.gl[0], M.glass); pane.renderOrder = 2; kit.excludeFromOverride(pane); g.add(pane);
      const hw = new THREE.Mesh(merge([
        box(0.07, 0.012, 0.016, 0, 0.035, -0.032, { r: 0.004, uv: false }),           // lift handle
        box(0.07, 0.012, 0.016, 0, 0.035, 0.032 + 0.003, { r: 0.004, uv: false }),
        box(0.05, 0.012, 0.03, 0, SH + 0.006, 0.0, { r: 0.004, uv: false }),          // sash lock on the meeting rail
        new THREE.CylinderGeometry(0.012, 0.012, 0.008, 16).translate(0.012, SH + 0.016, 0),
      ]), M.brass);
      hw.castShadow = true; g.add(hw);
      g.position.set(0, Y0, -0.015);
      root.add(g); lowerSash = g;
    } else {
      const lo = sashGeos(true, w.x, Y0, -0.015);
      frameParts.push(...lo.f); glassParts.push(...lo.gl);
    }
    if (!w.room) {
      // a dim classroom behind the neighbours' glass
      darkParts.push(new THREE.PlaneGeometry(W + 0.6, HEAD - SILL + 0.4).translate(w.x, (SILL + HEAD) / 2, -0.9));
      continue;
    }
    // interior: stool (the sill board inside), apron
    innerTrim.push(
      box(1.5, 0.035, 0.3, w.x, SILL - 0.0175, -0.3, { r: 0.006 }),
      box(1.42, 0.12, 0.02, w.x, SILL - 0.095, -0.16),
    );
  }
  add(merge(frameParts), M.trim, { interior: true });
  const glass = add(merge(glassParts), M.glass, { cast: false, receive: false });
  glass.renderOrder = 2; kit.excludeFromOverride(glass);
  add(merge(stoneParts), M.stone);
  add(merge(innerTrim), M.trim, { interior: true });
  if (darkParts.length) add(merge(darkParts), M.darkRoom, { cast: false, receive: false });

  // --- cast-iron column radiators under the room's windows (one section instanced) ---
  const sec = merge([
    box(0.052, 0.07, 0.17, 0, 0.6 - 0.035, 0, { r: 0.022, uv: false }),
    box(0.052, 0.07, 0.17, 0, 0.035, 0, { r: 0.022, uv: false }),
    ...[-0.052, 0, 0.052].map((z) => new THREE.CylinderGeometry(0.016, 0.016, 0.5, 10).translate(0, 0.3, z)),
    box(0.01, 0.46, 0.12, 0, 0.3, 0, { uv: false }),
  ]);
  const SECTIONS = 16, PITCH = 0.06;
  const rad = new THREE.InstancedMesh(sec, M.radiator, WINDOWS.length * SECTIONS);
  const m4 = new THREE.Matrix4();
  WINDOWS.forEach((w, wi) => {
    for (let s = 0; s < SECTIONS; s++) rad.setMatrixAt(wi * SECTIONS + s, m4.makeTranslation(w.x + (s - (SECTIONS - 1) / 2) * PITCH, ROOM.floor + 0.11, -0.27));
  });
  rad.castShadow = rad.receiveShadow = true; root.add(rad); kit.patchInterior(M.radiator);
  const pipes = [];
  WINDOWS.forEach((w) => {
    const x0 = w.x - (SECTIONS / 2) * PITCH;
    pipes.push(
      new THREE.CylinderGeometry(0.018, 0.018, 0.2, 12).translate(x0 - 0.05, ROOM.floor + 0.1, -0.27), // supply riser
      new THREE.CylinderGeometry(0.018, 0.018, 0.08, 12).rotateZ(Math.PI / 2).translate(x0 - 0.02, ROOM.floor + 0.175, -0.27),
      new THREE.CylinderGeometry(0.026, 0.026, 0.05, 14).translate(x0 - 0.05, ROOM.floor + 0.22, -0.27),    // valve body
      new THREE.TorusGeometry(0.03, 0.006, 6, 18).rotateX(Math.PI / 2).translate(x0 - 0.05, ROOM.floor + 0.29, -0.27), // wheel
      new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6).translate(x0 - 0.05, ROOM.floor + 0.265, -0.27),
      new THREE.CylinderGeometry(0.03, 0.03, 0.012, 14).translate(x0 - 0.05, ROOM.floor + 0.006, -0.27),   // floor escutcheon
      ...[-1, 1].map((sx) => box(0.05, 0.11, 0.1, w.x + sx * (SECTIONS / 2 - 0.5) * PITCH, ROOM.floor + 0.055, -0.27, { uv: false })), // feet
    );
  });
  add(merge(pipes), M.radiator, { interior: true });

  // --- venetian blinds, mounted inside the reveal (z −0.11) ---
  const slatGeo = new THREE.BoxGeometry(IW - 0.03, 0.0012, 0.025);
  const slats = [], rails = [], cords = [];
  WINDOWS.forEach((w) => {
    const top = HEAD - 0.036, zb = -0.112;
    rails.push(box(IW - 0.02, 0.036, 0.042, w.x, HEAD - 0.018, zb, { r: 0.004, uv: false }));
    const coverH = (HEAD - SILL) * (w.blind || 0);
    const stackN = Math.round(30 * (1 - (w.blind || 0)) + 6), hangN = Math.round(coverH / 0.021);
    let y = top - 0.006;
    for (let i = 0; i < stackN; i++) { slats.push([w.x, y, zb, 0.08]); y -= 0.0042; }
    for (let i = 0; i < hangN; i++) { y -= 0.021; slats.push([w.x, y, zb, w.tilt || 0]); }
    const bottomY = y - 0.012;
    rails.push(box(IW - 0.03, 0.014, 0.03, w.x, bottomY, zb, { r: 0.004, uv: false }));
    // ladder strings and lift cords through the slats
    for (const sx of [-0.33, 0.33]) for (const sz of [-0.013, 0.013]) cords.push(box(0.0012, top - bottomY, 0.0012, w.x + sx, (top + bottomY) / 2, zb + sz, { uv: false }));
    const cordX = w.x + IW / 2 - 0.05, cordBottom = Math.min(bottomY - 0.05, 1.62);
    cords.push(box(0.003, top - cordBottom, 0.003, cordX, (top + cordBottom) / 2, zb - 0.026, { uv: false }));
    cords.push(box(0.003, top - cordBottom, 0.003, cordX + 0.008, (top + cordBottom) / 2, zb - 0.026, { uv: false }));
    cords.push(new THREE.CylinderGeometry(0.008, 0.012, 0.05, 10).translate(cordX + 0.004, cordBottom - 0.02, zb - 0.026)); // tassel
    const wandX = w.x - IW / 2 + 0.05;
    cords.push(new THREE.CylinderGeometry(0.0035, 0.0035, 0.7, 6).translate(wandX, top - 0.38, zb - 0.026)); // tilt wand
  });
  const slatMesh = new THREE.InstancedMesh(slatGeo, M.slat, slats.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  slats.forEach(([x, y, z, tilt], i) => { q.setFromEuler(e.set(tilt, 0, 0)); slatMesh.setMatrixAt(i, m4.compose(p.set(x, y, z), q, s1)); });
  slatMesh.castShadow = slatMesh.receiveShadow = true; root.add(slatMesh); kit.patchInterior(M.slat);
  add(merge(rails), M.slat, { interior: true });
  add(merge(cords), M.cord, { cast: !low, interior: true });

  function setRaise(r) { raise = Math.max(0, Math.min(0.78, r)); lowerSash.position.y = Y0 + raise; }

  return {
    root, setRaise, get raise() { return raise; },
    sillTop: SILL, center: new THREE.Vector3(0, (SILL + HEAD) / 2, 0),
    windows: WINDOWS, high,
  };
}
