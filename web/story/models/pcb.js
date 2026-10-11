// Shared helpers for modelling printed-circuit hardware in code, at real scale.
//
// Conventions
// - Board art is drawn in board space: X right, Y up, millimetres, exactly like a mechanical drawing.
// - Geometry is built in millimetres inside a group scaled by 0.001 (so the scene stays in metres),
//   with +y up and board Y running along −z (a board lying flat, seen from above, reads like its drawing).
// - Textures are generated on canvases: colour (sRGB), "ORM" (R = clearcoat, G = roughness,
//   B = metalness, which is how three.js samples clearcoatMap / roughnessMap / metalnessMap) and a height
//   field that becomes the tangent-space normal map, so copper under the solder mask catches the light.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------------------------------
// basics

/** Small seeded PRNG (mulberry32) so the procedural layout is identical on every load. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quality knobs per render tier. */
export function quality(tier) {
  const low = tier === "low", high = tier === "high";
  return {
    tier, low, high,
    pxmm: high ? 20 : low ? 9 : 15, // board texture density (px per mm); ORM maps are half this
    atlas: low ? 1024 : 2048,
    normals: !low, // normal maps from the copper height field
    physical: !low, // MeshPhysicalMaterial + clearcoat
    transmission: false, // real refraction re-renders the whole room every frame; clear coat reads the same at this size
    smd: low ? 0.3 : high ? 1 : 0.75, // share of the fine SMD scatter kept
    fine: !low, // 0201 parts and other sub-millimetre details
    aniso: low ? 2 : 8,
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasTex(c, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Tangent-space normal map (OpenGL convention, +Y up) from a greyscale height canvas. */
export function normalFromHeight(src, strength = 2.5, blur = 0.7) {
  const w = src.width, h = src.height;
  let s = src;
  if (blur > 0) {
    const t = makeCanvas(w, h), g = t.getContext("2d");
    g.filter = `blur(${blur}px)`; // ignored where unsupported, which only makes the bevels crisper
    g.drawImage(src, 0, 0); s = t;
  }
  const d = s.getContext("2d").getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h), og = out.getContext("2d"), img = og.createImageData(w, h), o = img.data;
  const k = strength / 255;
  for (let y = 0; y < h; y++) {
    const yu = (y > 0 ? y - 1 : 0) * w, yd = (y < h - 1 ? y + 1 : h - 1) * w, row = y * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0, xr = x < w - 1 ? x + 1 : w - 1;
      const dx = (d[(row + xr) * 4] - d[(row + xl) * 4]) * k;
      const dy = (d[(yu + x) * 4] - d[(yd + x) * 4]) * k; // canvas rows run down, texture v runs up
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (row + x) * 4;
      o[i] = (0.5 - dx * il * 0.5) * 255; o[i + 1] = (0.5 - dy * il * 0.5) * 255; o[i + 2] = (0.5 + il * 0.5) * 255; o[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// board art: one drawing call paints colour, height and ORM together so they always line up

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export class BoardArt {
  /**
   * @param {object} o
   * @param {number[]} o.bounds [x0, y0, x1, y1] in mm (board space)
   * @param {number} o.pxmm texture density
   * @param {boolean} o.normals keep a height layer for the normal map
   * @param {object} o.palette { sub, cu, silk } css colours: bare laminate under mask, copper under mask, silkscreen
   */
  constructor({ bounds, pxmm, normals = true, orm = true, palette }) {
    const [x0, y0, x1, y1] = bounds;
    Object.assign(this, { x0, y0, x1, y1, s: pxmm });
    this.W = Math.ceil((x1 - x0) * pxmm); this.H = Math.ceil((y1 - y0) * pxmm);
    this.ls = { col: pxmm, orm: pxmm / 2, hgt: pxmm }; // per-layer density: roughness/metal/clearcoat don't need full res
    this.layers = { col: makeCanvas(this.W, this.H) };
    if (orm) this.layers.orm = makeCanvas(this.W / 2, this.H / 2);
    if (normals) this.layers.hgt = makeCanvas(this.W, this.H);
    this.g = {};
    for (const k in this.layers) {
      const g = this.layers[k].getContext("2d"), s = this.ls[k];
      g.setTransform(s, 0, 0, -s, -x0 * s, y1 * s); // mm, Y up
      g.lineCap = "round"; g.lineJoin = "round";
      this.g[k] = g;
    }
    const p = palette;
    this.pal = p;
    this.SUB = { col: p.sub, h: 0.0, orm: [1, 0.5, 0] };
    this.CU = { col: p.cu, h: 0.34, orm: [1, 0.4, 0] };
    this.SILK = { col: p.silk || "#f2f1ea", h: 0.6, orm: [0, 0.8, 0] };
    this.GOLD = { col: "#e9c37c", h: 0.46, orm: [0, 0.26, 1] };
    this.TIN = { col: "#d2d4d6", h: 0.62, orm: [0, 0.32, 1] };
    this.HOLE = { col: "#090a09", h: 0.0, orm: [0, 0.95, 0] };
  }

  _style(k, spec) {
    if (k === "col") return spec.col;
    if (k === "hgt") { const v = Math.round(spec.h * 255); return `rgb(${v},${v},${v})`; }
    const [a, b, c] = spec.orm; return `rgb(${Math.round(a * 255)},${Math.round(b * 255)},${Math.round(c * 255)})`;
  }
  /** Fill a path built by fn(g) on every layer. */
  fill(spec, fn) { for (const k in this.g) { const g = this.g[k]; g.beginPath(); fn(g); g.fillStyle = this._style(k, spec); g.fill("evenodd"); } }
  stroke(spec, width, fn) { for (const k in this.g) { const g = this.g[k]; g.beginPath(); fn(g); g.lineWidth = width; g.strokeStyle = this._style(k, spec); g.stroke(); } }

  all(spec) { this.fill(spec, (g) => g.rect(this.x0 - 1, this.y0 - 1, this.x1 - this.x0 + 2, this.y1 - this.y0 + 2)); }
  rect(spec, x, y, w, h) { this.fill(spec, (g) => g.rect(x, y, w, h)); }
  /** Rectangle by centre, optional rotation (radians, CCW). */
  rectC(spec, cx, cy, w, h, rot = 0) {
    this.fill(spec, (g) => {
      const c = Math.cos(rot), s = Math.sin(rot), pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, cx + x * c - y * s, cy + x * s + y * c));
      g.closePath();
    });
  }
  rrect(spec, x, y, w, h, r) { this.fill(spec, (g) => g.roundRect(x, y, w, h, r)); }
  circle(spec, cx, cy, r) { this.fill(spec, (g) => g.arc(cx, cy, r, 0, Math.PI * 2)); }
  ring(spec, cx, cy, r0, r1) { this.fill(spec, (g) => { g.arc(cx, cy, r1, 0, Math.PI * 2); g.moveTo(cx + r0, cy); g.arc(cx, cy, r0, 0, Math.PI * 2, true); }); }
  /** Outline rectangle (silkscreen style). */
  box(spec, x, y, w, h, lw = 0.15) { this.stroke(spec, lw, (g) => g.rect(x, y, w, h)); }
  line(spec, width, pts) { this.stroke(spec, width, (g) => pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))); }

  /** A copper track in a ground pour: dark clearance either side, copper in the middle. */
  track(pts, w = 0.15, clear = 0.13) { this.line(this.SUB, w + clear * 2, pts); this.line(this.CU, w, pts); }
  /** A copper track on bare laminate (no pour around it). */
  trackBare(pts, w = 0.15) { this.line(this.CU, w, pts); }
  /** Tented via in a pour. */
  via(x, y, r = 0.22, clear = 0.12) { this.circle(this.SUB, x, y, r + clear); this.circle(this.CU, x, y, r); this.circle({ col: this.pal.via || this.pal.sub, h: 0.24, orm: [1, 0.45, 0] }, x, y, r * 0.45); }
  /** Plated hole with an annular ring (gold by default). */
  plated(x, y, rHole, rPad, spec = this.GOLD) { this.circle(spec, x, y, rPad); this.circle(this.HOLE, x, y, rHole); }

  /** Text in board space; size = cap height-ish in mm. rot in radians (CCW). */
  text(spec, str, x, y, size, { rot = 0, align = "center", baseline = "middle", weight = 700, font = FONT, stretch = 1 } = {}) {
    for (const k in this.g) {
      const g = this.g[k], s = this.ls[k], px = (x - this.x0) * s, py = (this.y1 - y) * s;
      g.save(); g.setTransform(1, 0, 0, 1, px, py); g.rotate(-rot); g.scale(stretch, 1);
      g.font = `${weight} ${size * s * 1.32}px ${font}`; g.textAlign = align; g.textBaseline = baseline;
      g.fillStyle = this._style(k, spec); g.fillText(str, 0, 0);
      g.restore();
    }
  }

  /** Low-contrast mottling on the colour layer only, so the mask doesn't look like flat paint. */
  mottle(rand, amount = 1) {
    const g = this.g.col, n = Math.round((this.x1 - this.x0) * (this.y1 - this.y0) * 1.2 * amount);
    for (let i = 0; i < n; i++) {
      const x = this.x0 + rand() * (this.x1 - this.x0), y = this.y0 + rand() * (this.y1 - this.y0), r = 0.15 + rand() * 0.9;
      g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${0.012 + rand() * 0.02})` : `rgba(0,0,0,${0.015 + rand() * 0.025})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
}

/** A board's top-side PBR material from its art. */
export function boardMaterial(art, Q, { clearcoat = 0.6, normalStrength = 2.6, normalScale = 1 } = {}) {
  const map = canvasTex(art.layers.col, true, Q.aniso);
  const opts = { map, roughness: 1, metalness: 1 };
  if (art.layers.orm) { const orm = canvasTex(art.layers.orm, false, Q.aniso); Object.assign(opts, { roughnessMap: orm, metalnessMap: orm }); opts._orm = orm; }
  else { opts.roughness = 0.5; opts.metalness = 0; }
  if (art.layers.hgt && Q.normals) {
    opts.normalMap = canvasTex(normalFromHeight(art.layers.hgt, normalStrength), false, Q.aniso);
    opts.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  const orm = opts._orm; delete opts._orm;
  if (Q.physical) return new THREE.MeshPhysicalMaterial({ ...opts, clearcoat, clearcoatMap: orm || null, clearcoatRoughness: 0.2 });
  return new THREE.MeshStandardMaterial(opts);
}

// ---------------------------------------------------------------------------------------------------
// outlines and board geometry

/** Closed outline with rounded corners and optional edge features. Points are visited CCW.
 * corners: [[x, y, r], ...] in CCW order. features: [{ edge: i, at: t (mm along the edge), r, type: "ear" | "notch" }]
 * An "ear" is an outward half-disc centred on the edge (Grove mounting lugs); a "notch" an inward half-disc. */
export function outlineShape(corners, features = []) {
  const shape = new THREE.Shape();
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r] = corners[i], [px, py] = corners[(i - 1 + n) % n], [nx, ny] = corners[(i + 1) % n];
    const ax = px - x, ay = py - y, al = Math.hypot(ax, ay), bx = nx - x, by = ny - y, bl = Math.hypot(bx, by);
    const sx = x + (ax / al) * r, sy = y + (ay / al) * r, ex = x + (bx / bl) * r, ey = y + (by / bl) * r;
    if (i === 0) shape.moveTo(sx, sy); else shape.lineTo(sx, sy);
    if (r > 0) shape.quadraticCurveTo(x, y, ex, ey);
    // features on the edge from this corner to the next
    const dx = bx / bl, dy = by / bl, ang = Math.atan2(dy, dx);
    features.filter((f) => f.edge === i).sort((a, b) => a.at - b.at).forEach((f) => {
      const cx = x + dx * f.at, cy = y + dy * f.at;
      shape.lineTo(cx - dx * f.r, cy - dy * f.r);
      if (f.type === "ear") shape.absarc(cx, cy, f.r, ang + Math.PI, ang + Math.PI * 2, false);
      else shape.absarc(cx, cy, f.r, ang + Math.PI, ang, true);
    });
  }
  shape.closePath();
  return shape;
}

export function addHole(shape, x, y, r) { const p = new THREE.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); shape.holes.push(p); }

/** Extruded board: groups [0 bottom, 1 top, 2 edge]; lies in y ∈ [0, thick] with board (X, Y) → (x, −z). */
export function boardGeometry(shape, thick, bounds, curveSegments = 10) {
  const [x0, y0, x1, y1] = bounds, sx = x1 - x0, sy = y1 - y0;
  const UVGenerator = {
    generateTopUV(g, v, a, b, c) { return [a, b, c].map((i) => new THREE.Vector2((v[i * 3] - x0) / sx, (v[i * 3 + 1] - y0) / sy)); },
    generateSideWallUV(g, v, a, b, c, d) { return [a, b, c, d].map((i) => new THREE.Vector2((v[i * 3] + v[i * 3 + 1]) * 0.05, v[i * 3 + 2] * 0.3)); },
  };
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments, UVGenerator });
  const [lid, side] = geo.groups, half = lid.count / 2;
  geo.clearGroups();
  geo.addGroup(lid.start, half, 0);
  geo.addGroup(lid.start + half, half, 1);
  geo.addGroup(side.start, side.count, 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ---------------------------------------------------------------------------------------------------
// geometry helpers (all millimetres)

export function box(x0, y0, z0, x1, y1, z1) {
  return new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** Box by centre (x, z), bottom y and size. */
export function boxB(w, h, d, x = 0, y = 0, z = 0) { return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z); }
export function cylB(r, h, x = 0, y = 0, z = 0, seg = 24, rTop = r, open = false) {
  return new THREE.CylinderGeometry(rTop, r, h, seg, 1, open).translate(x, y + h / 2, z);
}
/** Cylinder along +z, starting at z. */
export function cylZ(r, len, x = 0, y = 0, z = 0, seg = 24, open = false) {
  return new THREE.CylinderGeometry(r, r, len, seg, 1, open).rotateX(Math.PI / 2).translate(x, y, z + len / 2);
}
export function flat(geo) { const g = geo.index ? geo.toNonIndexed() : geo; g.computeVertexNormals(); return g; }

const _c = new THREE.Color();
/** Bake a vertex colour (sRGB hex) into a geometry. */
export function paint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return geo;
}

export function mat4(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")), new THREE.Vector3(sx, sy, sz));
}

/** Merge geometries after normalising them to position / normal / uv (+ colour if any has one). */
export function mergeAll(list) {
  const withColor = list.some((g) => g.attributes.color);
  const prepared = list.map((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (withColor && !g.attributes.color) paint(g, 0xffffff);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    if (!withColor && g.attributes.color) g.deleteAttribute("color");
    g.clearGroups();
    return g;
  });
  return mergeGeometries(prepared, false);
}

/** Collects geometry per material key and emits one merged mesh per key. */
export class Batch {
  constructor() { this.lists = new Map(); }
  add(key, geo, color, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    if (color !== undefined && color !== null) paint(geo, color);
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(geo);
    return geo;
  }
  build(parent, materials) {
    const out = {};
    for (const [key, list] of this.lists) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeAll(list), materials[key]);
      mesh.name = key; mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh); out[key] = mesh;
    }
    return out;
  }
}

export function instanced(geo, material, matrices, colors) {
  const m = new THREE.InstancedMesh(geo, material, matrices.length);
  matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, _c.set(c)));
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

/** Square header pin with a pyramid tip, base at y = 0. */
export function pinGeometry(len = 6, size = 0.64, tip = 0.45) {
  const r = size / Math.SQRT2;
  const shaft = new THREE.CylinderGeometry(r, r, len - tip, 4, 1, true).rotateY(Math.PI / 4).translate(0, (len - tip) / 2, 0);
  const point = new THREE.CylinderGeometry(r * 0.32, r, tip, 4, 1, false).rotateY(Math.PI / 4).translate(0, len - tip / 2, 0);
  return flat(mergeAll([shaft, point]));
}

// ---------------------------------------------------------------------------------------------------
// texture atlas for package markings, lids and printed details (one material for many small parts)

export class Atlas {
  constructor(size = 2048, scale = 1) { this.size = size; this.scale = scale; this.queue = []; this.cells = {}; }
  /** draw(g, w, h, pass) paints the cell in px; pass is "col" or "orm"; it must cover a 4px pad around. */
  add(name, w, h, draw) { this.queue.push({ name, w: Math.round(w * this.scale), h: Math.round(h * this.scale), draw }); return this; }
  build(aniso = 8) {
    const S = this.size, pad = 4, col = makeCanvas(S, S), orm = makeCanvas(S, S);
    const cells = [...this.queue].sort((a, b) => b.h - a.h);
    let x = 0, y = 0, row = 0;
    for (const c of cells) {
      if (x + c.w + pad * 2 > S) { x = 0; y += row; row = 0; }
      c.x = x + pad; c.y = y + pad; x += c.w + pad * 2; row = Math.max(row, c.h + pad * 2);
    }
    if (y + row > S) console.warn("pcb atlas overflow", y + row, S);
    for (const [pass, cv] of [["col", col], ["orm", orm]]) {
      const g = cv.getContext("2d");
      for (const c of cells) {
        g.save(); g.translate(c.x, c.y);
        g.beginPath(); g.rect(-pad, -pad, c.w + pad * 2, c.h + pad * 2); g.clip();
        c.draw(g, c.w, c.h, pass, pad);
        g.restore();
      }
    }
    for (const c of cells) this.cells[c.name] = { u0: c.x / S, v0: 1 - (c.y + c.h) / S, du: c.w / S, dv: c.h / S };
    this.map = canvasTex(col, true, aniso);
    this.orm = canvasTex(orm, false, aniso);
    return this;
  }
  get(name) { return this.cells[name]; }
}

/** ORM fill style helper for atlas painters. */
export function ormStyle(rough, metal = 0, cc = 0) { return `rgb(${Math.round(cc * 255)},${Math.round(rough * 255)},${Math.round(metal * 255)})`; }

/** Remap a geometry's 0..1 UVs into atlas cells chosen by the vertex normal: top (+y), bottom, sides. */
export function atlasUV(geo, top, side = top, bottom = side) {
  const n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const ny = n.getY(i), c = ny > 0.7 ? top : ny < -0.7 ? bottom : side;
    uv.setXY(i, c.u0 + THREE.MathUtils.clamp(uv.getX(i), 0, 1) * c.du, c.v0 + THREE.MathUtils.clamp(uv.getY(i), 0, 1) * c.dv);
  }
  return geo;
}

// ---------------------------------------------------------------------------------------------------
// IC packages: body (atlas-mapped) + leads (tin). Built at the origin, body centred, sitting on y = 0.
// The body's top texture reads along +x with its top toward −z.

function leadGull(x, side, wl, armOut, h, footLen, t = 0.18) {
  // one gull-wing lead on the ±z side; x is its position along the body
  const z0 = side * armOut[0], z1 = side * armOut[1], zf = side * (armOut[1] + footLen);
  return [
    box(x - wl / 2, h - t, Math.min(z0, z1), x + wl / 2, h, Math.max(z0, z1)),
    box(x - wl / 2, 0, Math.min(z1, z1 + side * t), x + wl / 2, h, Math.max(z1, z1 + side * t)),
    box(x - wl / 2, 0, Math.min(z1, zf), x + wl / 2, t, Math.max(z1, zf)),
  ];
}

export function icPackage(kind, cells, opts = {}) {
  const leads = [];
  let body;
  const epoxy = cells.epoxy;
  const top = opts.cell || epoxy;
  if (kind === "soic8" || kind === "tssop20" || kind === "sot23" || kind === "sot23-5") {
    const P = {
      soic8: { L: 4.9, W: 3.9, H: 1.45, n: 4, pitch: 1.27, wl: 0.42, span: 6.0, lh: 0.7 },
      tssop20: { L: 6.5, W: 4.4, H: 1.0, n: 10, pitch: 0.65, wl: 0.24, span: 6.4, lh: 0.5 },
      sot23: { L: 2.9, W: 1.3, H: 1.0, n: 0, pitch: 0.95, wl: 0.4, span: 2.4, lh: 0.45 },
      "sot23-5": { L: 2.9, W: 1.6, H: 1.05, n: 0, pitch: 0.95, wl: 0.4, span: 2.8, lh: 0.45 },
    }[kind];
    body = boxB(P.L, P.H - 0.1, P.W, 0, 0.1, 0);
    const foot = (P.span - P.W) / 2 * 0.55, armOut = [P.W / 2, P.span / 2 - foot];
    if (P.n) {
      for (let i = 0; i < P.n; i++) {
        const x = (i - (P.n - 1) / 2) * P.pitch;
        leads.push(...leadGull(x, 1, P.wl, armOut, P.lh, foot), ...leadGull(x, -1, P.wl, armOut, P.lh, foot));
      }
    } else {
      const a = kind === "sot23" ? [[-P.pitch, 1], [P.pitch, 1], [0, -1]] : [[-P.pitch, 1], [0, 1], [P.pitch, 1], [-P.pitch, -1], [P.pitch, -1]];
      a.forEach(([x, s]) => leads.push(...leadGull(x, s, P.wl, armOut, P.lh, foot, 0.13)));
    }
  } else if (kind === "qfn") {
    const S = opts.size || 5, H = opts.h || 0.85, n = opts.pins || Math.round(S / 0.5) - 2;
    body = boxB(S, H, S, 0, 0, 0);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 0.5;
      [[t, S / 2], [t, -S / 2]].forEach(([x, z]) => leads.push(box(x - 0.12, 0, z - 0.03, x + 0.12, 0.2, z + 0.03)));
      [[S / 2, t], [-S / 2, t]].forEach(([x, z]) => leads.push(box(x - 0.03, 0, z - 0.12, x + 0.03, 0.2, z + 0.12)));
    }
  } else if (kind === "sma") {
    body = boxB(4.3, 2.0, 2.6, 0, 0.1, 0);
    [-1, 1].forEach((s) => { leads.push(box(s * 2.15, 0, -0.75, s * 2.4, 1.2, 0.75), box(s * 2.15, 0, -0.75, s * 2.75, 0.15, 0.75)); });
  } else if (kind === "tant") {
    body = boxB(3.2, 1.75, 2.6, 0, 0.05, 0);
    [-1, 1].forEach((s) => { leads.push(box(s * 1.55, 0, -0.6, s * 1.75, 1.0, 0.6), box(s * 1.45, 0, -0.6, s * 1.75, 0.12, 0.6)); });
  } else { // plain block (BGA / LGA / modules)
    body = boxB(opts.L || 5, opts.H || 1, opts.W || 5, 0, opts.lift || 0, 0);
  }
  atlasUV(body, top, opts.side || epoxy, epoxy);
  return { body, leads: leads.length ? mergeAll(leads) : null };
}

// ---------------------------------------------------------------------------------------------------
// SMD passives: instanced, with tin pads painted into the board art underneath

export const SMD_SIZES = { "0201": [0.6, 0.3, 0.26], "0402": [1.0, 0.5, 0.35], "0603": [1.6, 0.8, 0.45], "0805": [2.0, 1.25, 0.6], "1206": [3.2, 1.6, 0.75] };
export const SMD_KIND = { r: 0x141414, c: 0xa88c62, c2: 0x8e806b, c3: 0x6f6b62, l: 0x2b2b2b, y: 0xb98a3b };

function pick(rand, weights) {
  let t = rand() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { if ((t -= w) <= 0) return k; }
  return Object.keys(weights)[0];
}

export class SmdSet {
  constructor(seed = 7, Q) { this.rand = rng(seed); this.items = []; this.keep = []; this.Q = Q; }
  keepout(x0, y0, x1, y1, m = 0) { this.keep.push([Math.min(x0, x1) - m, Math.min(y0, y1) - m, Math.max(x0, x1) + m, Math.max(y0, y1) + m]); return this; }
  _free(b) {
    const hit = (k) => b[0] < k[2] && b[2] > k[0] && b[1] < k[3] && b[3] > k[1];
    return !this.keep.some(hit) && !this.items.some((it) => hit(it.pad));
  }
  /** Place one part at board (x, y); rot 0 = along X, 1 = along Y. */
  add(x, y, size = "0402", rot = 0, kind = "c", force = false) {
    const [L, W] = SMD_SIZES[size], w = rot ? W : L, h = rot ? L : W, m = 0.16;
    const pad = [x - w / 2 - m, y - h / 2 - m, x + w / 2 + m, y + h / 2 + m];
    if (!force && !this._free(pad)) return false;
    this.items.push({ x, y, size, rot, kind, pad });
    return true;
  }
  /** Random scatter inside a rectangle, snapped to a 0.05 mm grid, rows mostly aligned like real layouts. */
  scatter(r, n, { sizes = { "0402": 0.62, "0201": 0.23, "0603": 0.15 }, kinds = { c: 0.5, r: 0.32, c2: 0.12, c3: 0.06 }, rot } = {}) {
    if (!this.Q.fine) { sizes = { ...sizes }; delete sizes["0201"]; }
    n = Math.round(n * this.Q.smd);
    const [x0, y0, x1, y1] = r;
    for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
      const x = Math.round((x0 + this.rand() * (x1 - x0)) * 20) / 20, y = Math.round((y0 + this.rand() * (y1 - y0)) * 20) / 20;
      const o = rot ?? (this.rand() < 0.5 ? 0 : 1);
      if (this.add(x, y, pick(this.rand, sizes), o, pick(this.rand, kinds))) i++;
    }
    return this;
  }
  /** A tidy row (decoupling caps along a chip edge). */
  row(x, y, n, dx, dy, size = "0402", rot = 0, kind = "c") {
    for (let i = 0; i < n; i++) if (this.Q.fine || size !== "0201") this.add(x + dx * i, y + dy * i, size, rot, typeof kind === "function" ? kind(i) : kind);
    return this;
  }
  /** Tin pads (solder fillets) under each part's terminations. */
  paint(art) {
    for (const it of this.items) {
      const [L, W] = SMD_SIZES[it.size], cap = Math.max(0.16, L * 0.22), pl = cap + 0.2, pw = W + 0.12, off = L / 2 - cap / 2 + 0.04;
      for (const s of [-1, 1]) {
        if (it.rot) art.rectC(art.TIN, it.x, it.y + s * off, pw, pl); else art.rectC(art.TIN, it.x + s * off, it.y, pl, pw);
      }
    }
    return this;
  }
  /** Two instanced meshes: coloured bodies and tin end caps. toLocal(X, Y) → [x, z]; top = board top y. */
  build(parent, kit, toLocal, top) {
    if (!this.items.length) return;
    const bodyGeo = boxB(0.62, 1, 1, 0, 0, 0);
    const capGeo = mergeAll([boxB(0.2, 1.02, 1.03, -0.4, 0, 0), boxB(0.2, 1.02, 1.03, 0.4, 0, 0)]);
    const mats = [], cols = [];
    for (const it of this.items) {
      const [L, W, T] = SMD_SIZES[it.size], [x, z] = toLocal(it.x, it.y);
      mats.push(mat4(x, top, z, it.rot ? Math.PI / 2 : 0, 0, 0, L, T, W));
      cols.push(SMD_KIND[it.kind] ?? SMD_KIND.c);
    }
    parent.add(instanced(bodyGeo, kit.mat.smd, mats, cols));
    parent.add(instanced(capGeo, kit.mat.tin, mats));
  }
}

// ---------------------------------------------------------------------------------------------------
// Grove connectors and cables

/** Vertical Grove socket (HY2.0-4P shrouded header), mouth up. Long axis along z, latch window on +x.
 * Returns { plastic, pins } geometries in mm, base at y = 0. */
export function groveSocketVertical(color = 0xefe3c6) {
  const dark = new THREE.Color(color).multiplyScalar(0.55).getHex();
  const p = [
    box(-2.5, 0, -5.0, 2.5, 1.3, 5.0), // floor
    box(-2.5, 1.3, -5.0, -1.85, 6.0, 5.0), box(1.85, 1.3, -5.0, 2.5, 6.0, 5.0), // long walls
    box(-1.85, 1.3, -5.0, 1.85, 6.0, -4.3), box(-1.85, 1.3, 4.3, 1.85, 6.0, 5.0), // end walls
    box(2.5, 1.6, -1.6, 3.15, 6.0, -1.0), box(2.5, 1.6, 1.0, 3.15, 6.0, 1.6), box(2.5, 1.6, -1.0, 3.15, 2.6, 1.0), // latch frame
    box(-1.3, 0, 5.0, 1.3, 2.2, 5.75), // polarising end tab
  ].map((g) => paint(g, color));
  p.push(paint(box(2.5, 2.6, -1.0, 2.95, 6.0, 1.0), dark)); // latch window (recess)
  p.push(paint(box(-1.85, 1.3, -4.3, 1.85, 1.32, 4.3), dark)); // shadowed floor of the cavity
  const pins = [-3, -1, 1, 3].map((z) => box(-0.6, 1.3, z - 0.25, -0.1, 5.4, z + 0.25));
  return { plastic: mergeAll(p), pins: mergeAll(pins) };
}

/** Horizontal Grove socket (right-angle), mouth facing +x, long axis along z, base at y = 0. */
export function groveSocketHorizontal(color = 0xf2f1ec) {
  const dark = new THREE.Color(color).multiplyScalar(0.5).getHex();
  const p = [
    box(-3.8, 0, -5.0, -2.8, 5.8, 5.0), // back wall
    box(-3.8, 4.9, -5.0, 3.8, 5.8, 5.0), // roof
    box(-3.8, 0, -5.0, 3.8, 0.9, 5.0), // floor
    box(-3.8, 0.9, -5.0, 3.8, 4.9, -4.35), box(-3.8, 0.9, 4.35, 3.8, 4.9, 5.0), // ends
    box(3.4, 0, -5.6, 3.8, 1.6, 5.6), // front foot flange
  ].map((g) => paint(g, color));
  p.push(paint(box(0.4, 5.8, -1.3, 2.6, 5.84, 1.3), dark)); // latch window in the roof
  p.push(paint(box(-2.8, 0.9, -4.35, -2.75, 4.9, 4.35), dark)); // back of the cavity, in shadow
  const pins = [];
  for (const z of [-3, -1, 1, 3]) {
    pins.push(box(-2.8, 2.65, z - 0.25, 2.4, 3.15, z + 0.25)); // contact inside
    pins.push(box(-5.0, 2.65, z - 0.25, -3.8, 3.15, z + 0.25)); // tail out of the back
    pins.push(box(-5.0, -1.0, z - 0.25, -4.5, 3.15, z + 0.25)); // bent down into the board
  }
  return { plastic: mergeAll(p), pins: mergeAll(pins) };
}

/** Grove female plug (cable end). Insertion axis −y (front at y = 0), cable leaves at +y; latch tab on +x. */
export function grovePlug(color = 0xf1efe7) {
  const dark = new THREE.Color(color).multiplyScalar(0.62).getHex();
  const g = [
    box(-1.75, 0, -4.2, 1.75, 8.2, 4.2), // body
    box(-1.95, 5.2, -4.4, 1.95, 8.6, 4.4), // grip
    box(1.75, 1.8, -1.1, 2.15, 7.8, 1.1), // latch arm
    box(2.15, 2.2, -1.1, 2.75, 3.5, 1.1), // latch hook
    box(-1.5, 8.6, -2.6, 1.5, 9.3, 2.6), // strain relief
  ].map((x) => paint(x, color));
  g.push(paint(box(-1.76, 0.4, -3.6, 1.76, 1.0, 3.6), dark)); // contact window line
  return mergeAll(g);
}

/**
 * Flat 4-wire ribbon along a list of points. sides[i] gives the ribbon's width direction at each point
 * (interpolated from the plugs at both ends). Vertex-coloured, one tube per wire.
 */
export function ribbon(points, sideA, sideB, colors = [0x161616, 0xc0281f, 0xf2f2ee, 0xe2bd1f], r = 0.55, pitch = 1.12, radial = 7) {
  const n = points.length, pos = [], nor = [], col = [], idx = [];
  const T = [], S = [], N = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
    const s = sideA.clone().lerp(sideB, i / (n - 1));
    s.addScaledVector(t, -s.dot(t)).normalize();
    if (i && s.dot(S[i - 1]) < 0) s.negate();
    T.push(t); S.push(s); N.push(new THREE.Vector3().crossVectors(t, s).normalize());
  }
  colors.forEach((hex, w) => {
    _c.set(hex);
    const off = (w - (colors.length - 1) / 2) * pitch, base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const c = points[i].clone().addScaledVector(S[i], off);
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2, d = S[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(N[i], Math.sin(a));
        pos.push(c.x + d.x * r, c.y + d.y * r, c.z + d.z * r); nor.push(d.x, d.y, d.z); col.push(_c.r, _c.g, _c.b);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
      const a = base + i * (radial + 1) + k, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Single round cable (e.g. audio lead) along points. */
export function roundCable(points, r = 1.1, color = 0x121212, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  return paint(new THREE.TubeGeometry(curve, Math.max(24, points.length * 6), r, radial, false), color);
}

// ---------------------------------------------------------------------------------------------------
// 5x7 dot-matrix font (HD44780-style), ASCII 32..126, one byte per column, bit 0 = top row

const F57 = "0000000000 00005f0000 0007000700 147f147f14 242a7f2a12 2313086462 3649552250 0005030000 001c224100 0041221c00 14083e0814 08083e0808 0050300000 0808080808 0060600000 2010080402 3e5149453e 00427f4000 4261514946 2141454b31 1814127f10 2745454539 3c4a494930 0171090503 3649494936 064949291e 0036360000 0056360000 0814224100 1414141414 0041221408 0201510906 324979413e 7e1111117e 7f49494936 3e41414122 7f4141221c 7f49494941 7f09090901 3e4149497a 7f0808087f 00417f4100 2040413f01 7f08142241 7f40404040 7f020c027f 7f0408107f 3e4141413e 7f09090906 3e4151215e 7f09192946 4649494931 01017f0101 3f4040403f 1f2040201f 3f4038403f 6314081463 0708700807 6151494543 007f414100 0204081020 004141417f 0402010204 4040404040 0001020400 2054545478 7f48444438 3844444420 384444487f 3854545418 087e090102 0c5252523e 7f08040478 00447d4000 2040443d00 7f10284400 00417f4000 7c04180478 7c08040478 3844444438 7c14141408 081414187c 7c08040408 4854545420 043f444020 3c4040207c 1c2040201c 3c4030403c 4428102844 0c5050503c 4464544c44 0008364100 00007f0000 0041360800 0804081008".split(" ");

/** 40 booleans (5 wide × 8 tall, row-major) for a character; null for blank. Falls back to canvas sampling. */
const _glyphs = new Map();
export function glyph(ch) {
  if (_glyphs.has(ch)) return _glyphs.get(ch);
  let dots = null;
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) {
    const hex = F57[code - 32];
    if (code !== 32) {
      dots = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 5; c++) dots.push(r < 7 && ((parseInt(hex.substr(c * 2, 2), 16) >> r) & 1) === 1);
    }
  } else {
    const c = makeCanvas(50, 80), g = c.getContext("2d");
    g.font = "700 70px 'Courier New', monospace"; g.textBaseline = "top"; g.fillText(ch, 2, 2);
    const d = g.getImageData(0, 0, 50, 80).data; dots = [];
    for (let r = 0; r < 8; r++) for (let col = 0; col < 5; col++) {
      let a = 0; for (let yy = 0; yy < 10; yy++) for (let xx = 0; xx < 10; xx++) a += d[((r * 10 + yy) * 50 + col * 10 + xx) * 4 + 3];
      dots.push(a / (100 * 255) > 0.28);
    }
  }
  _glyphs.set(ch, dots);
  return dots;
}
