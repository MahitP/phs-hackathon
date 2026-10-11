// The classroom around the SkyWindow device: a high-school science room built from Poly Haven models
// (CC0: desks, chairs, the teacher's desk, laptop, lamp, clock, shelves, books, plants...) and code
// (walls, ceiling grid and troffers, whiteboard with a live AQI lesson, posters, flag, door, the lawn and
// trees outside). Lighting: the sun through the windows (one shadow map fitted to the window beams, plus an
// analytic window mask so no sunlight leaks through walls), RectAreaLight troffers and window skylight,
// the school-hall HDRI for reflections, and a ray-marched sunbeam with drifting dust.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ROOM, WINDOWS, SILL, HEAD, W, box, merge, tint, worldUV } from "./sash.js";
import { clamp, lerp, range, band, smooth } from "../util.js";

const MARKER = "'Marker Felt','Bradley Hand','Segoe Print','Comic Sans MS',cursive";
const PRINT = "Archivo, 'Helvetica Neue', Arial, sans-serif";

// ---------------------------------------------------------------- small helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function cnv(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function ctex(c, { srgb = true, tile, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (tile) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile[0], 1 / tile[1]); }
  return t;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
/** placement matrix: position, yaw (+ optional pitch/roll), uniform or vector scale */
function P(x, y, z, ry = 0, s = 1, rx = 0, rz = 0) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), typeof s === "number" ? _s.set(s, s, s) : _s.copy(s));
}

// ---------------------------------------------------------------- sunlight mask (shared GLSL)
// Projects a point along the sun direction onto the window wall planes and tests the openings, with a
// penumbra that widens with distance like the real sun's half-degree disc. Interior materials multiply
// the sun by this, so the directional light can only reach the room through the glass.
const APERTURE_GLSL = /* glsl */ `
  uniform vec3 uSunL; uniform vec4 uWins[3];
  float roomAperture(vec3 p, float zp) {
    float t = (zp - p.z) / max(uSunL.z, 1e-3);
    vec2 q = p.xy + uSunL.xy * t;
    float s = 0.003 + 0.0045 * max(t, 0.0);
    float m = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 w = uWins[i];
      vec2 a = smoothstep(w.xy - s, w.xy + s, q) * (1.0 - smoothstep(w.zw - s, w.zw + s, q));
      m = max(m, a.x * a.y);
    }
    return m;
  }
  float roomSunMask(vec3 p) {
    if (p.z > 0.16) return 1.0;
    if (uSunL.z < 0.015) return 0.0;
    float m = roomAperture(p, 0.15);
    if (p.z < -0.15) m *= roomAperture(p, -0.15);
    return m;
  }
`;

// ---------------------------------------------------------------- the kit: loaders, textures, base materials
export function createKit({ renderer, tier, manager }) {
  const low = tier === "low", high = tier === "high";
  const aniso = Math.min(low ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  const imgLoader = new THREE.ImageLoader(manager);
  const imgs = {};
  const img = (name) => (imgs[name] ??= new Promise((res) => imgLoader.load(`assets/textures/room/${name}.jpg`, res, undefined, () => res(null))));
  function tex(name, { srgb = false, tile = [1, 1] } = {}) {
    const t = new THREE.Texture();
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.repeat.set(1 / tile[0], 1 / tile[1]);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    img(name).then((im) => { if (im) { t.image = im; t.needsUpdate = true; } });
    return t;
  }
  function pbr(name, { tile = [1, 1], color = 0xffffff, normalScale = 1, roughness = 1, envMapIntensity = 1 } = {}) {
    const arm = tex(name + "_arm", { tile });
    return new THREE.MeshStandardMaterial({
      color, map: tex(name + "_Diffuse", { srgb: true, tile }), normalMap: tex(name + "_nor_gl", { tile }),
      normalScale: new THREE.Vector2(normalScale, normalScale), aoMap: arm, roughnessMap: arm, metalnessMap: arm,
      roughness, metalness: 1, envMapIntensity,
    });
  }

  const outdoor = [];
  const sunU = { uSunL: { value: V3(0, 0.5, 0.8) }, uWins: { value: WINDOWS.map((w) => new THREE.Vector4(w.x - W / 2, SILL, w.x + W / 2, HEAD)) } };
  const patched = new WeakSet();
  const lightsChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
    "getDirectionalLightInfo( directionalLight, directLight );",
    "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= roomSunMask( vRoomWP );",
  );
  /** interior materials only receive the sun through the window openings */
  function patchInterior(mat) {
    if (!mat || patched.has(mat) || !(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial)) return mat;
    patched.add(mat);
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      if (outdoor.includes(mat)) return; // shared with the outside (e.g. brick): no window mask
      sh.uniforms.uSunL = sunU.uSunL; sh.uniforms.uWins = sunU.uWins;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vRoomWP;").replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
        { vec4 rwp = vec4( transformed, 1.0 );
          #ifdef USE_BATCHING
          rwp = batchingMatrix * rwp;
          #endif
          #ifdef USE_INSTANCING
          rwp = instanceMatrix * rwp;
          #endif
          vRoomWP = ( modelMatrix * rwp ).xyz; }`);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vRoomWP;\n" + APERTURE_GLSL)
        .replace("#include <lights_fragment_begin>", lightsChunk);
    };
    mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : "") + (outdoor.includes(mat) ? "" : "|roomsun");
    mat.needsUpdate = true;
    return mat;
  }
  /** keep an object out of the override-material passes (GTAO normals, bokeh depth): glass, beams, haze */
  function excludeFromOverride(obj) {
    obj.onBeforeRender = function (r, scene, cam, geo) { if (scene.overrideMaterial) { this.userData.dr = geo.drawRange.count; geo.drawRange.count = 0; } };
    obj.onAfterRender = function (r, scene, cam, geo) { if (this.userData.dr !== undefined) { geo.drawRange.count = this.userData.dr; this.userData.dr = undefined; } };
  }

  // ---- procedural texture sets ----
  const wall = cmuTextures(img, aniso);
  const mat = {
    wall: new THREE.MeshStandardMaterial({ map: wall.map, normalMap: wall.normal, aoMap: wall.arm, roughnessMap: wall.arm, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1) }),
    brick: pbr("brick", { tile: [1.22, 0.95], normalScale: 1.5, envMapIntensity: 0.7 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xb8ad98, roughness: 0.86, normalMap: tex("ceiling_nor_gl", { tile: [0.6, 0.6] }), normalScale: new THREE.Vector2(1.1, 1.1) }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(false, aniso), color: 0xbdb8ae, roughness: 0.9 }),
    coping: new THREE.MeshStandardMaterial({ color: 0xdedcd4, roughness: 0.45, metalness: 0.35 }),
    gutter: new THREE.MeshStandardMaterial({ color: 0xe6e5df, roughness: 0.38, metalness: 0.45 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xf0efe9, roughness: 0.36 }),
    glass: high
      ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.03, metalness: 0, ior: 1.52, specularIntensity: 1, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: 0xe8eef2, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0.15, side: THREE.DoubleSide, depthWrite: false }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb79c5e, roughness: 0.32, metalness: 1 }),
    radiator: new THREE.MeshStandardMaterial({ color: 0xc9c7c0, roughness: 0.42, metalness: 0.55 }),
    slat: new THREE.MeshStandardMaterial({ color: 0xebe8e0, roughness: 0.4, metalness: 0.25 }),
    cord: new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.85 }),
    darkRoom: new THREE.MeshBasicMaterial({ map: darkRoomTexture() }),
  };
  [mat.brick, mat.stone, mat.concrete, mat.coping, mat.gutter, mat.glass].forEach((m) => outdoor.push(m));

  const gltf = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  return { tier, low, high, aniso, img, tex, pbr, mat, sunU, patchInterior, excludeFromOverride, outdoor, gltf, manager, renderer };
}

// ---------------------------------------------------------------- canvas textures
/** painted concrete block: 16×8 in blocks in running bond, 3 × 6 per 1.22 m tile */
function cmuTextures(img, aniso) {
  const S = 1024, T = 1.22, bw = S / 3, bh = S / 6, j = 8;
  const D = cnv(S, S), N = cnv(S, S), A = cnv(S, S);
  const map = ctex(D, { tile: [T, T], aniso }), normal = ctex(N, { srgb: false, tile: [T, T], aniso }), arm = ctex(A, { srgb: false, tile: [T, T], aniso });
  const joints = (fn) => {
    for (let row = 0; row <= 6; row++) fn("h", 0, row * bh);
    for (let row = 0; row < 6; row++) for (let col = 0; col <= 3; col++) fn("v", col * bw + (row % 2 ? bw / 2 : 0), row * bh);
  };
  function draw(dImg, nImg) {
    const r = rng(11);
    let g = D.getContext("2d");
    g.fillStyle = "#e7e1d3"; g.fillRect(0, 0, S, S);
    if (dImg) { g.save(); g.globalAlpha = 0.55; g.globalCompositeOperation = "soft-light"; g.filter = "grayscale(1) contrast(2.4)"; g.drawImage(dImg, 0, 0, S, S); g.restore(); }
    for (let row = 0; row < 6; row++) for (let col = -1; col < 3; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0);
      g.fillStyle = `rgba(${r() < 0.5 ? "60,50,40" : "255,255,250"},${0.012 + r() * 0.022})`; g.fillRect(x, row * bh, bw, bh);
    }
    for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(95,85,70,${0.04 + r() * 0.1})`; g.beginPath(); g.arc(r() * S, r() * S, 0.5 + r() * 1.4, 0, 7); g.fill(); }
    g.fillStyle = "rgba(140,128,108,0.2)";
    joints((k, x, y) => (k === "h" ? g.fillRect(0, y - j / 2, S, j) : g.fillRect(x - j / 2, y, j, bh)));
    // normals: paint texture + concave tooled joints
    g = N.getContext("2d");
    g.fillStyle = "rgb(128,128,255)"; g.fillRect(0, 0, S, S);
    if (nImg) g.drawImage(nImg, 0, 0, S, S);
    for (let i = 0; i < 9000; i++) { // pores showing through the paint
      const x = r() * S, y = r() * S, s = 0.8 + r() * 1.6;
      g.fillStyle = "rgba(160,128,255,0.5)"; g.fillRect(x - s, y, s, s * 2);
      g.fillStyle = "rgba(96,128,255,0.5)"; g.fillRect(x, y, s, s * 2);
    }
    joints((k, x, y) => {
      const grad = k === "h" ? g.createLinearGradient(0, y - j / 2 - 1, 0, y + j / 2 + 1) : g.createLinearGradient(x - j / 2 - 1, 0, x + j / 2 + 1, 0);
      const a = k === "h" ? ["rgb(128,60,215)", "rgb(128,196,215)"] : ["rgb(196,128,215)", "rgb(60,128,215)"];
      grad.addColorStop(0, "rgb(128,128,255)"); grad.addColorStop(0.2, a[0]); grad.addColorStop(0.5, "rgb(128,128,250)"); grad.addColorStop(0.8, a[1]); grad.addColorStop(1, "rgb(128,128,255)");
      g.fillStyle = grad;
      if (k === "h") g.fillRect(0, y - j / 2 - 1, S, j + 2); else g.fillRect(x - j / 2 - 1, y, j + 2, bh);
    });
    // AO / roughness: semi-gloss paint, rougher and darker joints
    g = A.getContext("2d");
    g.fillStyle = "rgb(255,118,0)"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,${100 + r() * 50},0,0.25)`; g.beginPath(); g.arc(r() * S, r() * S, 10 + r() * 50, 0, 7); g.fill(); }
    g.fillStyle = "rgb(178,175,0)";
    joints((k, x, y) => (k === "h" ? g.fillRect(0, y - j / 2, S, j) : g.fillRect(x - j / 2, y, j, bh)));
    map.needsUpdate = normal.needsUpdate = arm.needsUpdate = true;
  }
  draw(null, null);
  Promise.all([img("wall_Diffuse"), img("wall_nor_gl")]).then(([d, n]) => draw(d, n));
  return { map, normal, arm };
}

/** vinyl composition tile, 12 in squares, quarter-turned, 8 × 8 tiles per texture */
function vctTextures(size, aniso) {
  const S = size, TILES = 8, ts = S / TILES, T = 0.3048 * TILES;
  const D = cnv(S, S), N = cnv(S, S), A = cnv(S, S), r = rng(5);
  let g = D.getContext("2d");
  const tones = ["#d9d2c2", "#d6cfbe", "#dbd5c6", "#d3cbb9"];
  for (let i = 0; i < TILES; i++) for (let k = 0; k < TILES; k++) {
    const x = i * ts, y = k * ts, horiz = (i + k) % 2 === 0;
    g.save(); g.beginPath(); g.rect(x, y, ts, ts); g.clip();
    g.fillStyle = (i * 7 + k * 3) % 23 === 0 ? "#c9bea8" : tones[Math.floor(r() * tones.length)]; g.fillRect(x, y, ts, ts);
    for (let s = 0; s < 70; s++) { // marbled streaks run along the tile's grain
      const sx = x + r() * ts, sy = y + r() * ts, len = (0.15 + r() * 0.5) * ts, a = (horiz ? 0 : Math.PI / 2) + (r() - 0.5) * 0.35;
      g.strokeStyle = r() < 0.55 ? `rgba(250,246,236,${0.12 + r() * 0.16})` : `rgba(130,115,92,${0.08 + r() * 0.12})`;
      g.lineWidth = (0.6 + r() * 2.8) * S / 2048; g.beginPath(); g.moveTo(sx, sy);
      g.quadraticCurveTo(sx + Math.cos(a) * len * 0.5 + (r() - 0.5) * 8, sy + Math.sin(a) * len * 0.5 + (r() - 0.5) * 8, sx + Math.cos(a) * len, sy + Math.sin(a) * len); g.stroke();
    }
    for (let s = 0; s < 260; s++) { g.fillStyle = r() < 0.6 ? `rgba(105,92,74,${0.15 + r() * 0.25})` : `rgba(255,252,245,${0.3})`; g.fillRect(x + r() * ts, y + r() * ts, 1 + r() * 1.5, 1 + r() * 1.5); }
    g.restore();
  }
  for (let s = 0; s < 30; s++) { // a few scuffs from chair feet
    g.strokeStyle = `rgba(40,34,28,${0.05 + r() * 0.08})`; g.lineWidth = 1 + r() * 2.5;
    const sx = r() * S, sy = r() * S, a = r() * 6.28, l = 10 + r() * 60;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); g.stroke();
  }
  g.fillStyle = "rgba(90,78,62,0.55)";
  for (let i = 0; i <= TILES; i++) { g.fillRect(i * ts - 1, 0, 2, S); g.fillRect(0, i * ts - 1, S, 2); }
  g = N.getContext("2d");
  g.fillStyle = "rgb(128,128,255)"; g.fillRect(0, 0, S, S);
  for (let i = 0; i <= TILES; i++) {
    g.fillStyle = "rgb(150,128,250)"; g.fillRect(i * ts - 3, 0, 2, S); g.fillStyle = "rgb(106,128,250)"; g.fillRect(i * ts + 1, 0, 2, S);
    g.fillStyle = "rgb(128,106,250)"; g.fillRect(0, i * ts - 3, S, 2); g.fillStyle = "rgb(128,150,250)"; g.fillRect(0, i * ts + 1, S, 2);
  }
  g = A.getContext("2d");
  g.fillStyle = "rgb(255,78,0)"; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, rad = (20 + r() * 120) * S / 2048, gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(0,${10 + r() * 40 | 0},0,1)`); gr.addColorStop(1, "rgba(0,0,0,1)"); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "rgb(205,150,0)";
  for (let i = 0; i <= TILES; i++) { g.fillRect(i * ts - 1, 0, 2, S); g.fillRect(0, i * ts - 1, S, 2); }
  const opt = { tile: [T, T], aniso };
  return { map: ctex(D, opt), normal: ctex(N, { ...opt, srgb: false }), arm: ctex(A, { ...opt, srgb: false }) };
}

/** 2×2 ft fissured acoustic tile with tegular edges (one tile per texture) */
function ceilingTextures(img, aniso) {
  const S = 512, D = cnv(S, S), N = cnv(S, S), A = cnv(S, S);
  const opt = { tile: [0.6096, 0.6096], aniso };
  const map = ctex(D, opt), normal = ctex(N, { ...opt, srgb: false }), arm = ctex(A, { ...opt, srgb: false });
  [map, normal, arm].forEach((t) => t.offset.set(0.5, 0.59));
  function draw(dImg, nImg) {
    const r = rng(3);
    let g = D.getContext("2d");
    g.fillStyle = "#f1f0ec"; g.fillRect(0, 0, S, S);
    if (dImg) { g.save(); g.globalAlpha = 0.3; g.globalCompositeOperation = "soft-light"; g.filter = "grayscale(1) contrast(1.4)"; g.drawImage(dImg, 0, 0, S * 3, S * 3); g.restore(); }
    const worms = [];
    for (let i = 0; i < 320; i++) {
      let x = r() * S, y = r() * S; const pts = [[x, y]]; let a = r() * 6.28;
      for (let k = 0; k < 4 + r() * 6; k++) { a += (r() - 0.5) * 1.6; x += Math.cos(a) * 3; y += Math.sin(a) * 3; pts.push([x, y]); }
      worms.push([pts, 0.8 + r() * 1.4]);
    }
    for (const [pts, w] of worms) { g.strokeStyle = "rgba(132,128,118,0.3)"; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(110,104,92,${0.1 + r() * 0.25})`; g.fillRect(r() * S, r() * S, 1.2, 1.2); }
    const e = 9; // tegular edge
    const eg = (x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, "rgba(90,86,78,0.35)"); gr.addColorStop(1, "rgba(90,86,78,0)"); return gr; };
    g.fillStyle = eg(0, 0, e, 0); g.fillRect(0, 0, e, S); g.fillStyle = eg(S, 0, S - e, 0); g.fillRect(S - e, 0, e, S);
    g.fillStyle = eg(0, 0, 0, e); g.fillRect(0, 0, S, e); g.fillStyle = eg(0, S, 0, S - e); g.fillRect(0, S - e, S, e);
    g = N.getContext("2d");
    g.fillStyle = "rgb(128,128,255)"; g.fillRect(0, 0, S, S);
    if (nImg) { g.globalAlpha = 0.8; g.drawImage(nImg, 0, 0, S * 3, S * 3); g.globalAlpha = 1; }
    for (const [pts, w] of worms) { g.strokeStyle = "rgba(150,100,240,0.6)"; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    g.fillStyle = "rgb(70,128,230)"; g.fillRect(0, 0, e, S); g.fillStyle = "rgb(186,128,230)"; g.fillRect(S - e, 0, e, S);
    g.fillStyle = "rgb(128,186,230)"; g.fillRect(0, 0, S, e); g.fillStyle = "rgb(128,70,230)"; g.fillRect(0, S - e, S, e);
    g = A.getContext("2d");
    g.fillStyle = "rgb(255,240,0)"; g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgb(205,240,0)"; g.lineWidth = e; g.strokeRect(e / 2, e / 2, S - e, S - e);
    map.needsUpdate = normal.needsUpdate = arm.needsUpdate = true;
  }
  draw(null, null);
  Promise.all([img("ceiling_Diffuse"), img("ceiling_nor_gl")]).then(([d, n]) => draw(d, n));
  return { map, normal, arm };
}

function concreteTexture(joints, aniso) {
  const S = 512, c = cnv(S, S), g = c.getContext("2d"), r = rng(joints ? 21 : 22);
  g.fillStyle = "#c9c5bc"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1600; i++) { const x = r() * S, y = r() * S, rad = 2 + r() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, rad); const v = r() < 0.5 ? "70,66,60" : "255,252,245"; gr.addColorStop(0, `rgba(${v},${0.03 + r() * 0.05})`); gr.addColorStop(1, `rgba(${v},0)`); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "60,58,52" : "240,238,230"},${0.1 + r() * 0.2})`; g.fillRect(r() * S, r() * S, 1.3, 1.3); }
  if (joints) { g.fillStyle = "rgba(70,66,58,0.6)"; g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S); }
  return ctex(c, { tile: joints ? [1.5, 1.5] : [1.2, 1.2], aniso });
}

function darkRoomTexture() {
  const c = cnv(64, 128), g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, "#3b3d3f"); gr.addColorStop(0.2, "#23252a"); gr.addColorStop(0.7, "#17181b"); gr.addColorStop(1, "#1c1c1d");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
  g.fillStyle = "rgba(220,225,235,0.35)"; g.fillRect(14, 6, 36, 5);
  return ctex(c);
}

/** a dense clump of leaves on a transparent card: solid in the middle, ragged at the edge */
function leafTexture(small) {
  const S = 512, c = cnv(S, S), g = c.getContext("2d"), r = rng(small ? 41 : 42);
  const blobs = [];
  for (let i = 0; i < 16; i++) { const a = r() * 6.28, d = r() * S * 0.2; blobs.push([S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d * 0.85, S * (0.11 + r() * 0.12)]); }
  const inside = (x, y) => blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 < br * br);
  g.strokeStyle = "rgba(60,48,36,0.9)"; g.lineWidth = small ? 2 : 3;
  for (let i = 0; i < 7; i++) { const a = r() * 6.28; g.beginPath(); g.moveTo(S / 2, S / 2); g.quadraticCurveTo(S / 2 + Math.cos(a + 0.4) * S * 0.2, S / 2 + Math.sin(a + 0.4) * S * 0.2, S / 2 + Math.cos(a) * S * 0.36, S / 2 + Math.sin(a) * S * 0.36); g.stroke(); }
  const N = small ? 3600 : 4200;
  for (let i = 0; i < N; i++) {
    let x, y, k = 0;
    do { x = r() * S; y = r() * S; k++; } while (!inside(x, y) && k < 24);
    if (k >= 24) continue;
    if (i > N * 0.8) { const a = r() * 6.28, d = S * (0.06 + r() * 0.05); x += Math.cos(a) * d; y += Math.sin(a) * d; } // sprigs breaking the outline
    const t = i / N, l = small ? 8 + r() * 7 : 9 + r() * 8, w = l * 0.55;
    const sh = (0.5 + 0.55 * t + (r() - 0.5) * 0.22) * (1.08 - (y / S) * 0.3);
    g.fillStyle = `rgb(${(80 + r() * 34) * sh | 0},${(108 + r() * 42) * sh | 0},${(42 + r() * 24) * sh | 0})`;
    g.save(); g.translate(x, y); g.rotate(r() * 6.28); g.beginPath(); g.ellipse(0, 0, l / 2, w / 2, 0, 0, 7); g.fill(); g.restore();
  }
  const t = ctex(c); t.generateMipmaps = true; return t;
}

function fabricNormal() {
  const S = 256, c = cnv(S, S), g = c.getContext("2d"), r = rng(9);
  g.fillStyle = "rgb(128,128,255)"; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 4) { g.fillStyle = "rgba(128,150,250,0.6)"; g.fillRect(0, y, S, 1); g.fillStyle = "rgba(128,106,250,0.6)"; g.fillRect(0, y + 2, S, 1); }
  for (let x = 0; x < S; x += 4) { g.fillStyle = "rgba(150,128,250,0.35)"; g.fillRect(x, 0, 1, S); g.fillStyle = "rgba(106,128,250,0.35)"; g.fillRect(x + 2, 0, 1, S); }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${100 + r() * 56},${100 + r() * 56},250,0.3)`; g.fillRect(r() * S, r() * S, 3, 3); }
  const t = ctex(c, { srgb: false, tile: [0.08, 0.08] }); return t;
}

// ---------------------------------------------------------------- printed / handwritten canvases
function drawWhiteboard(c, aqi, date) {
  const g = c.getContext("2d"), Wd = c.width, H = c.height, r = rng(77);
  g.fillStyle = "#f6f7f4"; g.fillRect(0, 0, Wd, H);
  // ghosts of erased lessons and eraser swipes
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(150,155,160,${0.025 + r() * 0.035})`; g.beginPath(); g.ellipse(r() * Wd, r() * H, 60 + r() * 220, 18 + r() * 40, (r() - 0.5) * 0.6, 0, 7); g.fill(); }
  g.save(); g.globalAlpha = 0.07; g.fillStyle = "#3a3f4a"; g.font = `40px ${MARKER}`;
  g.fillText("HW: p. 214  #1–9", 1460, 640); g.fillText("photosynthesis  6CO₂ + 6H₂O", 760, 120); g.restore();
  const ink = (col, a = 0.93) => { g.fillStyle = col; g.strokeStyle = col; g.globalAlpha = a; };
  const text = (s, x, y, size, col, rot = 0) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.font = `${size}px ${MARKER}`; ink(col);
    g.fillText(s, 0, 0); g.globalAlpha = 0.25; g.fillText(s, 0.8, 0.6); g.restore();
  };
  const line = (pts, col, w = 4) => { g.save(); ink(col, 0.9); g.lineWidth = w; g.lineCap = g.lineJoin = "round"; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore(); };
  const BLUE = "#1d3f9a", BLACK = "#1b1d22", RED = "#c22a22", GREEN = "#1d7a3a";

  text("Air Quality Index (AQI)", 70, 104, 66, BLUE, -0.008);
  line([[72, 124], [300, 121], [560, 125], [742, 120]], BLUE, 4);
  const bands = [["0 – 50", "Good", "#2e9e46"], ["51 – 100", "Moderate", "#e2b100"], ["101 – 150", "Unhealthy for sensitive groups", "#e8701a"], ["151 – 200", "Unhealthy", "#cf2b23"]];
  bands.forEach(([rngTxt, name, col], i) => {
    const y = 196 + i * 66;
    g.save(); g.globalAlpha = 0.85; g.fillStyle = col; g.fillRect(84, y - 34, 40, 34); g.restore();
    line([[82, y - 36], [126, y - 37], [127, y + 1], [83, y], [82, y - 36]], BLACK, 2.5);
    text(rngTxt, 150, y, 46, BLACK, 0.004);
    text(name, 370, y, 46, i > 1 ? RED : BLACK, -0.004);
  });
  text("smoke & haze → PM2.5 ↑", 110, 492, 40, GREEN, -0.01);

  // sketch: sun, haze layer, ground, the beam and its angle
  const sx = 1300, sy = 150;
  g.save(); ink("#e07a12", 0.9); g.lineWidth = 5; g.beginPath(); g.arc(sx, sy, 44, 0, 7); g.stroke();
  for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; line([[sx + Math.cos(a) * 56, sy + Math.sin(a) * 56], [sx + Math.cos(a) * 80, sy + Math.sin(a) * 80]], "#e07a12", 4); }
  g.restore();
  for (let k = 0; k < 3; k++) {
    const pts = []; for (let x = 1180; x <= 1960; x += 12) pts.push([x, 318 + k * 22 + Math.sin(x * 0.045 + k) * 7]);
    line(pts, "#7b818c", 3);
  }
  for (let i = 0; i < 120; i++) { g.save(); ink("#7b818c", 0.6); g.beginPath(); g.arc(1190 + r() * 760, 312 + r() * 60, 2.4, 0, 7); g.fill(); g.restore(); }
  text("haze  (AOD)", 1790, 296, 38, BLUE);
  line([[1170, 572], [1960, 568]], BLACK, 5);
  for (let x = 1185; x < 1950; x += 34) line([[x, 572], [x - 9, 590]], GREEN, 3);
  const gx = 1700, gy = 570;
  line([[sx + 30, sy + 34], [gx, gy]], RED, 5);
  line([[gx, gy], [gx - 30, gy - 8], [gx, gy], [gx - 18, gy - 26]], RED, 5);
  g.save(); ink(BLACK, 0.9); g.lineWidth = 3.5; g.beginPath(); g.arc(gx, gy, 92, Math.PI + 0.0, Math.PI + 0.86, false); g.stroke(); g.restore();
  text("θ", gx - 140, gy - 28, 46, BLACK);
  text("T = e", 1440, 236, 56, BLACK, -0.01);
  text("−AOD / sin θ", 1578, 204, 36, BLACK, -0.01);
  text("beam getting through", 1452, 474, 34, RED, -0.01);

  // live value
  text("Today's AQI:", 72, 628, 54, BLACK, -0.006);
  const v = aqi == null ? "?" : String(Math.round(aqi));
  const col = aqi == null ? BLACK : aqi <= 50 ? "#1f8a3c" : aqi <= 100 ? "#c58a00" : aqi <= 150 ? "#e0640f" : "#c22a22";
  text(v, 410, 634, 78, col, -0.02);
  g.save(); ink(col, 0.85); g.lineWidth = 4.5; g.beginPath(); g.ellipse(410 + v.length * 21, 608, 34 + v.length * 22, 46, -0.05, 0, 6.6); g.stroke(); g.restore();
  text(date, 1730, 72, 40, BLACK, 0.01);
  g.globalAlpha = 1;
}

function drawPeriodicTable(c) {
  const g = c.getContext("2d"), Wd = c.width, H = c.height;
  const S = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" ");
  const sets = {
    alkali: [3, 11, 19, 37, 55, 87], alkaline: [4, 12, 20, 38, 56, 88], metalloid: [5, 14, 32, 33, 51, 52],
    nonmetal: [1, 6, 7, 8, 15, 16, 34], halogen: [9, 17, 35, 53, 85, 117], noble: [2, 10, 18, 36, 54, 86, 118],
    post: [13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116],
  };
  const COL = { alkali: "#f2a07b", alkaline: "#f6cf7c", transition: "#f3e3a2", post: "#b9dcae", metalloid: "#9fd3c7", nonmetal: "#a9c8ee", halogen: "#c4b7ea", noble: "#e3b4d6", lanth: "#f4c2b0", act: "#e9b8c9" };
  const cat = (z) => { for (const k in sets) if (sets[k].includes(z)) return k; if (z >= 57 && z <= 71) return "lanth"; if (z >= 89 && z <= 103) return "act"; return "transition"; };
  const pos = (z) => {
    if (z === 1) return [1, 1]; if (z === 2) return [1, 18];
    if (z <= 4) return [2, z - 2]; if (z <= 10) return [2, z + 8];
    if (z <= 12) return [3, z - 10]; if (z <= 18) return [3, z];
    if (z <= 36) return [4, z - 18]; if (z <= 54) return [5, z - 36];
    if (z <= 56) return [6, z - 54]; if (z <= 71) return [9, z - 54]; if (z <= 86) return [6, z - 68];
    if (z <= 88) return [7, z - 86]; if (z <= 103) return [10, z - 86]; return [7, z - 100];
  };
  g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, Wd, H);
  g.fillStyle = "#1f2b44"; g.fillRect(0, 0, Wd, 120);
  g.fillStyle = "#fff"; g.font = `800 64px ${PRINT}`; g.textAlign = "center"; g.fillText("PERIODIC TABLE OF THE ELEMENTS", Wd / 2, 84);
  const cw = (Wd - 80) / 18, ch = (H - 210) / 10.4, ox = 40, oy = 150;
  for (let z = 1; z <= 118; z++) {
    const [row, col] = pos(z), x = ox + (col - 1) * cw, y = oy + (row - 1) * ch + (row > 7 ? ch * 0.4 : 0);
    g.fillStyle = COL[cat(z)]; g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    g.strokeStyle = "rgba(40,40,50,0.35)"; g.lineWidth = 1.5; g.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
    g.fillStyle = "#222631"; g.textAlign = "left"; g.font = `600 ${ch * 0.2 | 0}px ${PRINT}`; g.fillText(String(z), x + 8, y + ch * 0.26);
    g.textAlign = "center"; g.font = `800 ${ch * 0.42 | 0}px ${PRINT}`; g.fillText(S[z - 1], x + cw / 2, y + ch * 0.72);
  }
  [[6, 3, "57–71"], [7, 3, "89–103"]].forEach(([row, col, t]) => { const x = ox + (col - 1) * cw, y = oy + (row - 1) * ch; g.fillStyle = COL[row === 6 ? "lanth" : "act"]; g.fillRect(x + 2, y + 2, cw - 4, ch - 4); g.fillStyle = "#222631"; g.font = `600 ${ch * 0.2 | 0}px ${PRINT}`; g.fillText(t, x + cw / 2, y + ch * 0.6); });
  const keys = [["alkali", "Alkali metals"], ["alkaline", "Alkaline earth"], ["transition", "Transition metals"], ["post", "Post-transition"], ["metalloid", "Metalloids"], ["nonmetal", "Nonmetals"], ["halogen", "Halogens"], ["noble", "Noble gases"]];
  g.textAlign = "left"; g.font = `600 22px ${PRINT}`;
  keys.forEach(([k, t], i) => { const x = ox + 2.6 * cw + (i % 4) * cw * 2.6, y = oy + ch * 0.25 + Math.floor(i / 4) * 34; g.fillStyle = COL[k]; g.fillRect(x, y, 26, 22); g.fillStyle = "#222631"; g.fillText(t, x + 34, y + 19); });
}

function drawPoster(c, kind) {
  const g = c.getContext("2d"), Wd = c.width, H = c.height;
  if (kind === "method") {
    g.fillStyle = "#123b5c"; g.fillRect(0, 0, Wd, H);
    g.fillStyle = "#ffd25a"; g.font = `800 74px ${PRINT}`; g.textAlign = "center"; g.fillText("THE SCIENTIFIC", Wd / 2, 120); g.fillText("METHOD", Wd / 2, 200);
    const steps = ["Ask a question", "Do background research", "Form a hypothesis", "Test with an experiment", "Analyze the data", "Draw a conclusion", "Share your results"];
    const cols = ["#ef6f5e", "#f39a4b", "#f4c84a", "#7cc576", "#45b3a8", "#4f8fd6", "#9a78d0"];
    steps.forEach((s, i) => {
      const y = 270 + i * 150;
      g.fillStyle = cols[i]; g.beginPath(); g.roundRect(80, y, Wd - 160, 112, 22); g.fill();
      g.fillStyle = "rgba(255,255,255,0.9)"; g.beginPath(); g.arc(150, y + 56, 40, 0, 7); g.fill();
      g.fillStyle = "#123b5c"; g.font = `800 50px ${PRINT}`; g.fillText(String(i + 1), 150, y + 74);
      g.fillStyle = "#fff"; g.textAlign = "left"; g.font = `700 50px ${PRINT}`; g.fillText(s, 220, y + 73); g.textAlign = "center";
      if (i < steps.length - 1) { g.fillStyle = "rgba(255,255,255,0.6)"; g.beginPath(); g.moveTo(Wd / 2 - 18, y + 116); g.lineTo(Wd / 2 + 18, y + 116); g.lineTo(Wd / 2, y + 136); g.fill(); }
    });
  } else if (kind === "safety") {
    g.fillStyle = "#fdfbf4"; g.fillRect(0, 0, Wd, H);
    g.fillStyle = "#e3a21a"; g.fillRect(0, 0, Wd, 210);
    g.fillStyle = "#1c1c1c"; g.font = `900 92px ${PRINT}`; g.textAlign = "center"; g.fillText("LAB SAFETY", Wd / 2, 130);
    g.font = `600 36px ${PRINT}`; g.fillText("Rules for every experiment", Wd / 2, 185);
    const rules = ["Wear safety goggles", "Tie back long hair", "No food or drink", "Know where the eyewash is", "Report every spill", "Wash your hands after", "Never work alone"];
    g.textAlign = "left";
    rules.forEach((s, i) => {
      const y = 300 + i * 140;
      g.fillStyle = "#e3a21a"; g.beginPath(); g.moveTo(90, y + 50); g.lineTo(130, y - 20); g.lineTo(170, y + 50); g.closePath(); g.fill();
      g.fillStyle = "#1c1c1c"; g.font = `900 46px ${PRINT}`; g.fillText("!", 121, y + 40);
      g.font = `600 52px ${PRINT}`; g.fillText(s, 210, y + 40);
      g.fillStyle = "rgba(0,0,0,0.1)"; g.fillRect(90, y + 80, Wd - 180, 3);
    });
  } else if (kind === "fair") {
    g.fillStyle = "#1a7a6c"; g.fillRect(0, 0, Wd, H);
    g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 3;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(Wd * 0.78, H * 0.26, 200, 70, i * 0.35, 0, 7); g.stroke(); }
    g.fillStyle = "#ffcf3f"; g.beginPath(); g.arc(Wd * 0.78, H * 0.26, 34, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.font = `900 120px ${PRINT}`; g.textAlign = "left"; g.fillText("SCIENCE", 70, 560); g.fillStyle = "#ffcf3f"; g.fillText("FAIR", 70, 690);
    g.fillStyle = "#fff"; g.font = `700 52px ${PRINT}`; g.fillText("Thursday, February 11", 74, 820); g.font = `500 44px ${PRINT}`;
    g.fillText("6:00 pm · PHS Gym", 74, 890); g.fillText("Sign up in Room 204", 74, 960); g.fillText("by January 22", 74, 1020);
    g.font = `600 34px ${PRINT}`; g.fillStyle = "rgba(255,255,255,0.75)"; g.fillText("Projects: physics · chemistry · biology · earth & air", 74, 1150);
  }
}

/** sheets pinned to the cork board, all on one atlas (4 × 3 cells, 512 × 680 each) */
function drawPaperAtlas(c, now) {
  const g = c.getContext("2d"), CW = 512, CH = 680, r = rng(13);
  const cell = (i) => [(i % 4) * CW, Math.floor(i / 4) * CH];
  const lined = (x, y, bg = "#fdfdf8") => {
    g.fillStyle = bg; g.fillRect(x, y, CW, CH); g.strokeStyle = "rgba(90,130,200,0.35)"; g.lineWidth = 2;
    for (let yy = y + 90; yy < y + CH - 20; yy += 26) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + CW, yy); g.stroke(); }
    g.strokeStyle = "rgba(220,80,80,0.45)"; g.beginPath(); g.moveTo(x + 70, y); g.lineTo(x + 70, y + CH); g.stroke();
  };
  const scribble = (x, y, w, rows, col, size = 22) => {
    g.fillStyle = col; g.font = `${size}px ${MARKER}`;
    const words = "the air in our room gets stale after lunch so we tested CO2 with the sensor and opened the window for ten minutes it dropped".split(" ");
    for (let k = 0; k < rows; k++) { let s = "", xx = 0; while (xx < w) { const wd = words[(r() * words.length) | 0]; s += wd + " "; xx += wd.length * size * 0.48; } g.fillText(s, x, y + k * 26); }
  };
  // 0: calendar for the real month
  let [x, y] = cell(0);
  g.fillStyle = "#ffffff"; g.fillRect(x, y, CW, CH);
  g.fillStyle = "#c0392b"; g.fillRect(x, y, CW, 110);
  g.fillStyle = "#fff"; g.font = `800 52px ${PRINT}`; g.textAlign = "center";
  g.fillText(now.toLocaleString("en-US", { month: "long" }).toUpperCase() + " " + now.getFullYear(), x + CW / 2, y + 74);
  const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay(), days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  g.font = `600 22px ${PRINT}`; g.fillStyle = "#555";
  "SMTWTFS".split("").forEach((d, i) => g.fillText(d, x + 40 + i * 72, y + 145));
  for (let d = 1; d <= days; d++) {
    const k = first + d - 1, cx = x + 40 + (k % 7) * 72, cy = y + 200 + Math.floor(k / 7) * 84;
    g.strokeStyle = "rgba(0,0,0,0.12)"; g.strokeRect(cx - 34, cy - 40, 70, 82);
    g.fillStyle = d === now.getDate() ? "#c0392b" : "#333"; g.font = `${d === now.getDate() ? 800 : 500} 26px ${PRINT}`; g.fillText(String(d), cx, cy);
    if (d === now.getDate()) { g.strokeStyle = "#c0392b"; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy - 9, 24, 0, 7); g.stroke(); g.lineWidth = 1; }
  }
  // 1: bell schedule
  [x, y] = cell(1);
  g.fillStyle = "#fff8e1"; g.fillRect(x, y, CW, CH); g.fillStyle = "#333"; g.textAlign = "center"; g.font = `800 44px ${PRINT}`; g.fillText("BELL SCHEDULE", x + CW / 2, y + 80);
  g.font = `500 28px ${PRINT}`; g.textAlign = "left";
  ["Period 1   7:50 – 8:43", "Period 2   8:48 – 9:41", "Period 3   9:46 – 10:39", "Period 4  10:44 – 11:37", "Lunch       11:37 – 12:20", "Period 5  12:25 – 1:18", "Period 6   1:23 – 2:16", "Period 7   2:21 – 3:00"]
    .forEach((s, i) => { g.fillStyle = i % 2 ? "#333" : "#1d3f9a"; g.fillText(s, x + 50, y + 170 + i * 58); });
  // 2: science fair flyer
  [x, y] = cell(2);
  { const t = cnv(800, 1200); drawPoster(t, "fair"); g.drawImage(t, x, y, CW, CH); }
  // 3: lunch menu
  [x, y] = cell(3);
  g.fillStyle = "#eaf6ea"; g.fillRect(x, y, CW, CH); g.fillStyle = "#2c6e3f"; g.textAlign = "center"; g.font = `800 42px ${PRINT}`; g.fillText("CAFETERIA MENU", x + CW / 2, y + 76);
  g.font = `500 26px ${PRINT}`; g.textAlign = "left"; g.fillStyle = "#2a2a2a";
  ["Mon  Chicken tacos", "Tue  Pasta primavera", "Wed  Veggie burger", "Thu  Teriyaki bowl", "Fri  Pizza day!"].forEach((s, i) => g.fillText(s, x + 46, y + 170 + i * 92));
  // 4, 5: student write-ups
  [x, y] = cell(4); lined(x, y); g.textAlign = "left"; g.fillStyle = "#1d3f9a"; g.font = `34px ${MARKER}`; g.fillText("Lab 3: Is our air stale?", x + 84, y + 60); scribble(x + 84, y + 114, 380, 20, "#2b3a66");
  [x, y] = cell(5); lined(x, y, "#fffdf4"); g.fillStyle = "#333"; g.font = `34px ${MARKER}`; g.fillText("Haze & sunlight — Maya R.", x + 84, y + 60); scribble(x + 84, y + 114, 380, 14, "#3b3b3b");
  g.strokeStyle = "#c22a22"; g.lineWidth = 4; g.beginPath(); g.arc(x + 420, y + 600, 40, 0, 7); g.stroke(); g.fillStyle = "#c22a22"; g.font = `40px ${MARKER}`; g.fillText("A", x + 405, y + 614);
  // 6: water-cycle drawing
  [x, y] = cell(6);
  g.fillStyle = "#ffffff"; g.fillRect(x, y, CW, CH);
  g.fillStyle = "#7fc4ef"; g.fillRect(x, y + 470, CW, 210); g.fillStyle = "#6ea85a"; g.beginPath(); g.moveTo(x, y + 480); g.lineTo(x + 200, y + 330); g.lineTo(x + 330, y + 480); g.fill();
  g.fillStyle = "#f4c430"; g.beginPath(); g.arc(x + 420, y + 110, 52, 0, 7); g.fill();
  g.fillStyle = "#dfe7ef"; [[150, 140], [210, 120], [260, 150]].forEach(([a, b]) => { g.beginPath(); g.arc(x + a, y + b, 50, 0, 7); g.fill(); });
  g.strokeStyle = "#1d6fb8"; g.lineWidth = 6; g.beginPath(); g.moveTo(x + 400, y + 440); g.quadraticCurveTo(x + 470, y + 300, x + 300, y + 190); g.stroke();
  g.fillStyle = "#1d3f9a"; g.font = `36px ${MARKER}`; g.fillText("evaporation", x + 300, y + 300); g.fillText("rain", x + 150, y + 260); g.fillText("The Water Cycle", x + 40, y + 640);
  // 7: fire drill route
  [x, y] = cell(7);
  g.fillStyle = "#fff"; g.fillRect(x, y, CW, CH); g.fillStyle = "#b71c1c"; g.fillRect(x, y, CW, 96); g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `800 40px ${PRINT}`; g.fillText("FIRE EXIT ROUTE", x + CW / 2, y + 64);
  g.strokeStyle = "#333"; g.lineWidth = 4; g.strokeRect(x + 60, y + 150, 390, 420); g.strokeRect(x + 60, y + 150, 160, 160); g.strokeRect(x + 290, y + 150, 160, 160);
  g.strokeStyle = "#2e7d32"; g.lineWidth = 9; g.beginPath(); g.moveTo(x + 150, y + 250); g.lineTo(x + 250, y + 420); g.lineTo(x + 420, y + 540); g.stroke();
  g.fillStyle = "#333"; g.font = `600 26px ${PRINT}`; g.fillText("YOU ARE HERE  ·  Room 204", x + CW / 2, y + 625);
  // 8: club flyer
  [x, y] = cell(8);
  g.fillStyle = "#ffe14d"; g.fillRect(x, y, CW, CH); g.fillStyle = "#1a1a1a"; g.textAlign = "center"; g.font = `900 64px ${PRINT}`; g.fillText("ROBOTICS", x + CW / 2, y + 140); g.fillText("CLUB", x + CW / 2, y + 214);
  g.font = `500 32px ${PRINT}`; g.fillText("Tuesdays after school", x + CW / 2, y + 330); g.fillText("Room 118 · all welcome", x + CW / 2, y + 380);
  for (let i = 0; i < 6; i++) { g.fillStyle = "#fff"; g.fillRect(x + 20 + i * 82, y + 560, 60, 110); g.fillStyle = "#333"; g.save(); g.translate(x + 56 + i * 82, y + 660); g.rotate(-Math.PI / 2); g.font = `500 20px ${PRINT}`; g.fillText("ext. 2241", 0, 0); g.restore(); }
  // 9: AQI colour chart (printed)
  [x, y] = cell(9);
  g.fillStyle = "#fff"; g.fillRect(x, y, CW, CH); g.fillStyle = "#222"; g.font = `800 40px ${PRINT}`; g.fillText("AIR QUALITY INDEX", x + CW / 2, y + 70);
  [["#00e400", "0–50 Good"], ["#ffff00", "51–100 Moderate"], ["#ff7e00", "101–150 USG"], ["#ff0000", "151–200 Unhealthy"], ["#8f3f97", "201–300 Very unhealthy"], ["#7e0023", "301+ Hazardous"]]
    .forEach(([col, t], i) => { g.fillStyle = col; g.fillRect(x + 40, y + 120 + i * 88, CW - 80, 70); g.fillStyle = i > 3 ? "#fff" : "#111"; g.font = `700 30px ${PRINT}`; g.fillText(t, x + CW / 2, y + 166 + i * 88); });
  // 10, 11: graph paper with a plotted curve; a quiz with a grade
  [x, y] = cell(10);
  g.fillStyle = "#fbfdfb"; g.fillRect(x, y, CW, CH); g.strokeStyle = "rgba(60,150,90,0.25)"; g.lineWidth = 1;
  for (let k = 0; k < CW; k += 20) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k, y + CH); g.stroke(); }
  for (let k = 0; k < CH; k += 20) { g.beginPath(); g.moveTo(x, y + k); g.lineTo(x + CW, y + k); g.stroke(); }
  g.strokeStyle = "#1d3f9a"; g.lineWidth = 4; g.beginPath(); for (let k = 0; k <= 40; k++) { const xx = x + 60 + k * 10, yy = y + 560 - 380 * Math.exp(-k / 12); k ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } g.stroke();
  g.fillStyle = "#333"; g.font = `30px ${MARKER}`; g.fillText("CO2 after opening the window", x + CW / 2, y + 70);
  [x, y] = cell(11); lined(x, y); g.fillStyle = "#333"; g.font = `32px ${MARKER}`; g.textAlign = "left"; g.fillText("Quiz 2 — Aerosols", x + 84, y + 60); scribble(x + 84, y + 114, 360, 16, "#333", 21);
  g.fillStyle = "#c22a22"; g.font = `64px ${MARKER}`; g.fillText("94%", x + 330, y + 190);
  g.textAlign = "left";
}

function drawFlag(c) {
  const g = c.getContext("2d"), Wd = c.width, H = c.height, sh = H / 13;
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? "#ffffff" : "#b22234"; g.fillRect(0, i * sh, Wd, sh + 1); }
  const cw = Wd * 0.4, chh = sh * 7; g.fillStyle = "#3c3b6e"; g.fillRect(0, 0, cw, chh);
  g.fillStyle = "#fff";
  const star = (cx, cy, rr) => { g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? rr * 0.38 : rr; g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } g.fill(); };
  for (let row = 0; row < 9; row++) { const n = row % 2 ? 5 : 6; for (let k = 0; k < n; k++) star(cw / 12 * (row % 2 ? 2 + k * 2 : 1 + k * 2), chh / 10 * (row + 1), chh * 0.032); }
}

function drawExit(c) {
  const g = c.getContext("2d"), Wd = c.width, H = c.height;
  g.fillStyle = "#f4f2ec"; g.fillRect(0, 0, Wd, H);
  g.fillStyle = "#e01d1d"; g.font = `900 ${H * 0.62}px ${PRINT}`; g.textAlign = "center"; g.fillText("EXIT", Wd / 2, H * 0.74);
  g.beginPath(); g.moveTo(Wd * 0.08, H * 0.5); g.lineTo(Wd * 0.15, H * 0.36); g.lineTo(Wd * 0.15, H * 0.64); g.fill();
  g.beginPath(); g.moveTo(Wd * 0.92, H * 0.5); g.lineTo(Wd * 0.85, H * 0.36); g.lineTo(Wd * 0.85, H * 0.64); g.fill();
}
function exitEmissive(c) {
  const g = c.getContext("2d"), Wd = c.width, H = c.height;
  g.fillStyle = "#000"; g.fillRect(0, 0, Wd, H);
  g.fillStyle = "#ff2a20"; g.font = `900 ${H * 0.62}px ${PRINT}`; g.textAlign = "center"; g.fillText("EXIT", Wd / 2, H * 0.74);
  g.beginPath(); g.moveTo(Wd * 0.08, H * 0.5); g.lineTo(Wd * 0.15, H * 0.36); g.lineTo(Wd * 0.15, H * 0.64); g.fill();
  g.beginPath(); g.moveTo(Wd * 0.92, H * 0.5); g.lineTo(Wd * 0.85, H * 0.36); g.lineTo(Wd * 0.85, H * 0.64); g.fill();
}

function drawLaptopScreen(c) {
  const g = c.getContext("2d"), Wd = c.width, H = c.height;
  const gr = g.createLinearGradient(0, 0, Wd, H); gr.addColorStop(0, "#1f4e79"); gr.addColorStop(1, "#16324f"); g.fillStyle = gr; g.fillRect(0, 0, Wd, H);
  g.fillStyle = "#f4f6f8"; g.fillRect(30, 26, Wd - 60, H - 80);
  g.fillStyle = "#1f4e79"; g.fillRect(30, 26, Wd - 60, 34); g.fillStyle = "#fff"; g.font = `600 18px ${PRINT}`; g.fillText("Unit 3 — Air quality.ppt", 44, 49);
  g.fillStyle = "#222"; g.font = `800 34px ${PRINT}`; g.fillText("Why does haze dim the sun?", 52, 110);
  [["#2e9e46", 0.3], ["#e2b100", 0.55], ["#e8701a", 0.75], ["#cf2b23", 0.92]].forEach(([col, h], i) => { g.fillStyle = col; g.fillRect(70 + i * 90, H - 80 - h * 200, 60, h * 200); });
  g.fillStyle = "#444"; g.font = `500 18px ${PRINT}`; g.fillText("Beer–Lambert:  T = e^(−AOD / sin θ)", 440, 200);
  g.fillStyle = "#c9ced6"; g.fillRect(0, H - 40, Wd, 40);
}

function outletTexture() {
  const c = cnv(128, 208), g = c.getContext("2d");
  g.fillStyle = "#efeadf"; g.fillRect(0, 0, 128, 208);
  for (const cy of [62, 146]) {
    g.fillStyle = "#e3ddcf"; g.beginPath(); g.ellipse(64, cy, 36, 40, 0, 0, 7); g.fill();
    g.fillStyle = "#2a2a2a"; g.fillRect(48, cy - 16, 6, 22); g.fillRect(74, cy - 16, 6, 26); g.beginPath(); g.arc(64, cy + 18, 7, Math.PI, 0); g.fill(); g.fillRect(57, cy + 18, 14, 6);
  }
  g.fillStyle = "#b9b2a2"; g.beginPath(); g.arc(64, 104, 6, 0, 7); g.fill();
  return ctex(c);
}

function grilleTexture(round) {
  const S = 256, c = cnv(S, S), g = c.getContext("2d");
  g.fillStyle = "#f0efea"; g.fillRect(0, 0, S, S);
  g.fillStyle = "#3b3d40";
  for (let y = 6; y < S; y += 10) for (let x = 6 + ((y / 10) % 2) * 5; x < S; x += 10) {
    if (round && (x - S / 2) ** 2 + (y - S / 2) ** 2 > (S * 0.44) ** 2) continue;
    g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
  }
  return ctex(c);
}

function prismTexture() {
  const S = 128, c = cnv(S, S), g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, S, S);
  g.strokeStyle = "rgba(200,206,214,0.9)"; g.lineWidth = 1.2;
  for (let k = -S; k < S * 2; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke(); g.beginPath(); g.moveTo(k, S); g.lineTo(k + S, 0); g.stroke(); }
  const t = ctex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 10); return t;
}

function corkTextures() {
  const S = 512, D = cnv(S, S), N = cnv(S, S), r = rng(31);
  const g = D.getContext("2d"), n = N.getContext("2d");
  g.fillStyle = "#b98c5c"; g.fillRect(0, 0, S, S); n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const x = r() * S, y = r() * S, s = 0.8 + r() * 2.2, v = r();
    g.fillStyle = v < 0.45 ? `rgba(110,72,40,${0.3 + r() * 0.4})` : v < 0.8 ? `rgba(220,180,130,${0.25 + r() * 0.35})` : `rgba(70,45,25,0.5)`;
    g.fillRect(x, y, s, s);
    n.fillStyle = `rgba(${100 + r() * 56 | 0},${100 + r() * 56 | 0},250,0.5)`; n.fillRect(x, y, s, s);
  }
  return { map: ctex(D, { tile: [0.5, 0.5] }), normal: ctex(N, { srgb: false, tile: [0.5, 0.5] }) };
}

function corridorTexture() {
  const c = cnv(256, 256), g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "#e9e8e2"); gr.addColorStop(0.62, "#d5d2c8"); gr.addColorStop(0.64, "#b9b3a6"); gr.addColorStop(1, "#cdc7ba");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) { g.fillStyle = "#5d7a9a"; g.fillRect(x + 2, 60, 28, 100); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 4, 70, 2, 8); }
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 18);
  return ctex(c);
}

function wireGlassTexture() {
  const S = 128, c = cnv(S, S), g = c.getContext("2d");
  g.clearRect(0, 0, S, S); g.strokeStyle = "rgba(60,62,66,0.85)"; g.lineWidth = 1.4;
  for (let k = -S; k < S * 2; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke(); g.beginPath(); g.moveTo(k, S); g.lineTo(k + S, 0); g.stroke(); }
  const t = ctex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 6); return t;
}

// ---------------------------------------------------------------- glTF helpers
function partsOf(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => { if (o.isMesh) out.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone(), name: o.name }); });
  return out;
}
/** a sub-object of a merged glTF mesh: same vertex buffers, filtered triangles (pred gets the model-space centroid) */
function extract(part, pred) {
  const g = part.geometry, pos = g.attributes.position, idx = g.index, m = part.matrix;
  const keep = [], box3 = new THREE.Box3(), t = [V3(), V3(), V3()], c = V3();
  for (let i = 0; i < idx.count; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) { t[k].fromBufferAttribute(pos, idx.getX(i + k)).applyMatrix4(m); c.add(t[k]); }
    c.multiplyScalar(1 / 3);
    if (pred(c)) { keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)); t.forEach((v) => box3.expandByPoint(v)); }
  }
  const ng = new THREE.BufferGeometry();
  for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]);
  ng.setIndex(keep);
  return { geometry: ng, material: part.material, matrix: m, box: box3, name: part.name };
}
function boundsOf(parts) {
  const b = new THREE.Box3();
  for (const p of parts) {
    if (p.box) { b.union(p.box); continue; }
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    b.union(p.geometry.boundingBox.clone().applyMatrix4(p.matrix));
  }
  return b;
}
/** origin matrix that puts the parts' footprint centre at (0, 0, 0) with the bottom on y = 0, scaled by s */
function footprint(parts, s = 1) {
  const b = boundsOf(parts), c = b.getCenter(V3());
  return new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z));
}

// ---------------------------------------------------------------- the classroom
export function createClassroom({ scene, renderer, tier, kit, win, camera }) {
  const low = tier === "low", mid = tier === "mid", high = tier === "high";
  const { mat: M, patchInterior, excludeFromOverride } = kit;
  const R = ROOM, FL = R.floor, CEIL = R.ceil;
  RectAreaLightUniformsLib.init();
  const now = new Date();

  // material buckets: everything static that shares a material becomes one mesh
  const buckets = new Map();
  const put = (m, ...geos) => { if (!buckets.has(m)) buckets.set(m, []); buckets.get(m).push(...geos); };
  const flush = (opts = new Map()) => {
    for (const [m, geos] of buckets) {
      const o = opts.get(m) || {};
      const mesh = new THREE.Mesh(merge(geos), m);
      mesh.castShadow = o.cast ?? true; mesh.receiveShadow = o.receive ?? true;
      if (o.order) mesh.renderOrder = o.order;
      scene.add(mesh); patchInterior(m);
    }
    buckets.clear();
  };
  const noCast = new Map();
  const addMesh = (geo, m, { cast = true, receive = true } = {}) => { const o = new THREE.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = receive; scene.add(o); patchInterior(m); return o; };
  const std = (o) => new THREE.MeshStandardMaterial(o);

  // ---------------- materials
  const floorT = vctTextures(low ? 1024 : 2048, kit.aniso);
  const ceilT = ceilingTextures(kit.img, kit.aniso);
  const mat = {
    floor: std({ map: floorT.map, normalMap: floorT.normal, aoMap: floorT.arm, roughnessMap: floorT.arm, roughness: 1, metalness: 0, envMapIntensity: 0.8 }),
    ceiling: std({ color: 0xe6edf6, map: ceilT.map, normalMap: ceilT.normal, normalScale: new THREE.Vector2(0.8, 0.8), aoMap: ceilT.arm, roughnessMap: ceilT.arm, roughness: 1, metalness: 0, envMapIntensity: 0.3 }),
    grid: std({ color: 0xf2f1ed, roughness: 0.45, metalness: 0.15 }),
    enamel: std({ color: 0xf4f4f1, roughness: 0.32, metalness: 0.05 }),
    base: std({ color: 0x3a3532, roughness: 0.55 }),
    wood: kit.pbr("wood", { tile: [0.9, 1.9], color: 0xd9c0a2, envMapIntensity: 0.6 }),
    doorFrame: std({ color: 0x5a5d61, roughness: 0.42, metalness: 0.55 }),
    steel: std({ color: 0xd6d8da, roughness: 0.26, metalness: 1 }),
    darkSteel: std({ color: 0x2b2d30, roughness: 0.4, metalness: 0.7 }),
    alu: std({ color: 0xc9ccd0, roughness: 0.3, metalness: 1 }),
    plastic: std({ color: 0xf0ede4, roughness: 0.45 }),
    blackPlastic: std({ color: 0x1b1c1f, roughness: 0.42 }),
    greyPlastic: std({ color: 0x6d7076, roughness: 0.5 }),
    chrome: std({ color: 0xe6e8ea, roughness: 0.15, metalness: 1 }),
    gold: std({ color: 0xc9a24a, roughness: 0.3, metalness: 1 }),
    paper: std({ color: 0xffffff, roughness: 0.92 }),
    soil: std({ color: 0x2e2219, roughness: 1 }),
    fabric: std({ vertexColors: true, roughness: 0.86, normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.6, 0.6) }),
    vinyl: std({ roughness: 0.48 }),
    bottle: std({ vertexColors: true, roughness: 0.34, metalness: 0.35 }),
    ceramic: std({ color: 0xf3f1ea, roughness: 0.18 }),
  };

  // ---------------- shell: floor, walls, ceiling
  addMesh(worldUV(new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0).rotateX(-Math.PI / 2).translate(0, FL, (R.z0 + R.z1) / 2)), mat.floor);
  const DOOR = { z0: -5.06, z1: -4.14, h: 2.14 };
  const walls = [
    new THREE.PlaneGeometry(R.x1 - R.x0, CEIL - FL + 0.02).translate(0, (CEIL + FL) / 2, R.z0),                                      // back
    new THREE.PlaneGeometry(R.z1 - R.z0, CEIL - FL + 0.02).rotateY(Math.PI / 2).translate(R.x0, (CEIL + FL) / 2, (R.z0 + R.z1) / 2),  // left
    new THREE.PlaneGeometry(DOOR.z0 - R.z0, CEIL - FL + 0.02).rotateY(-Math.PI / 2).translate(R.x1, (CEIL + FL) / 2, (R.z0 + DOOR.z0) / 2),
    new THREE.PlaneGeometry(R.z1 - DOOR.z1, CEIL - FL + 0.02).rotateY(-Math.PI / 2).translate(R.x1, (CEIL + FL) / 2, (DOOR.z1 + R.z1) / 2),
    new THREE.PlaneGeometry(DOOR.z1 - DOOR.z0, CEIL - DOOR.h).rotateY(-Math.PI / 2).translate(R.x1, (CEIL + DOOR.h) / 2, (DOOR.z0 + DOOR.z1) / 2),
  ].map(worldUV);
  put(M.wall, ...walls);
  // the door reveal through the wall thickness
  put(M.wall, box(0.16, DOOR.h, 0.01, R.x1 + 0.08, DOOR.h / 2, DOOR.z0 - 0.005), box(0.16, DOOR.h, 0.01, R.x1 + 0.08, DOOR.h / 2, DOOR.z1 + 0.005));
  addMesh(worldUV(new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0).rotateX(Math.PI / 2).translate(0, CEIL, (R.z0 + R.z1) / 2)), mat.ceiling);

  // suspended ceiling grid (2 × 2 ft) and fixtures that sit in it
  const GX = (k) => 0.3048 + k * 0.6096, GZ = (k) => -0.36 - k * 0.6096;
  const grid = [];
  for (let k = -8; k <= 7; k++) { const x = GX(k); if (x > R.x0 && x < R.x1) grid.push(box(0.024, 0.014, R.z1 - R.z0, x, CEIL - 0.007, (R.z0 + R.z1) / 2, { uv: false })); }
  for (let k = 0; k < 14; k++) { const z = GZ(k); if (z > R.z0 && z < R.z1) grid.push(box(R.x1 - R.x0, 0.014, 0.024, 0, CEIL - 0.007, z, { uv: false })); }
  put(mat.grid, ...grid);
  // wall angle trim where the ceiling meets the walls
  put(mat.grid, box(R.x1 - R.x0, 0.02, 0.02, 0, CEIL - 0.01, R.z0 + 0.01, { uv: false }), box(0.02, 0.02, R.z1 - R.z0, R.x0 + 0.01, CEIL - 0.01, (R.z0 + R.z1) / 2, { uv: false }),
    box(0.02, 0.02, R.z1 - R.z0, R.x1 - 0.01, CEIL - 0.01, (R.z0 + R.z1) / 2, { uv: false }), box(R.x1 - R.x0, 0.02, 0.02, 0, CEIL - 0.01, R.z1 - 0.01, { uv: false }));

  // troffers: 2 × 4 ft prismatic fixtures, 3 × 3
  const TROFFERS = [];
  for (const x of [-2.4384, 0, 2.4384]) for (const z of [GZ(3), GZ(7), GZ(11)]) TROFFERS.push([x, z]);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: prismTexture(), emissive: 0xfff8ee, emissiveIntensity: 3.2, roughness: 0.6 });
  lensMat.emissiveMap = lensMat.map;
  const lenses = [], housings = [];
  for (const [x, z] of TROFFERS) {
    housings.push(box(0.6, 0.012, 0.022, x, CEIL - 0.006, z - 0.595, { uv: false }), box(0.6, 0.012, 0.022, x, CEIL - 0.006, z + 0.595, { uv: false }),
      box(0.022, 0.012, 1.19, x - 0.289, CEIL - 0.006, z, { uv: false }), box(0.022, 0.012, 1.19, x + 0.289, CEIL - 0.006, z, { uv: false }));
    lenses.push(new THREE.PlaneGeometry(0.556, 1.168).rotateX(Math.PI / 2).translate(x, CEIL - 0.004, z));
  }
  put(mat.enamel, ...housings);
  addMesh(merge(lenses), lensMat, { cast: false, receive: false });

  // HVAC: two four-way supply diffusers and a return grille
  const diffusers = [];
  for (const [x, z] of [[GX(-4) + 0.3048, GZ(5) - 0.3048], [GX(3) + 0.3048, GZ(9) - 0.3048]]) {
    for (let k = 0; k < 4; k++) {
      const s = 0.58 - k * 0.12, y = CEIL - 0.012 - k * 0.014, t = 0.03;
      diffusers.push(box(s, 0.012, t, x, y, z - s / 2 + t / 2, { uv: false }), box(s, 0.012, t, x, y, z + s / 2 - t / 2, { uv: false }),
        box(t, 0.012, s, x - s / 2 + t / 2, y, z, { uv: false }), box(t, 0.012, s, x + s / 2 - t / 2, y, z, { uv: false }));
    }
    diffusers.push(box(0.12, 0.01, 0.12, x, CEIL - 0.068, z, { uv: false }));
  }
  put(mat.enamel, ...diffusers);
  const grilleMat = std({ map: grilleTexture(false), roughness: 0.5 });
  addMesh(new THREE.PlaneGeometry(0.58, 0.58).rotateX(Math.PI / 2).translate(GX(-1) + 0.3048, CEIL - 0.004, GZ(9) - 0.3048), grilleMat, { cast: false });
  // PA speaker, smoke detector, sprinkler heads, a ceiling projector
  const spkMat = std({ map: grilleTexture(true), roughness: 0.5 });
  addMesh(new THREE.CircleGeometry(0.15, 40).rotateX(Math.PI / 2).translate(GX(-3) + 0.3048, CEIL - 0.004, GZ(5) - 0.3048), spkMat, { cast: false });
  put(mat.enamel, new THREE.TorusGeometry(0.155, 0.008, 6, 40).rotateX(Math.PI / 2).translate(GX(-3) + 0.3048, CEIL - 0.006, GZ(5) - 0.3048));
  put(mat.plastic, new THREE.CylinderGeometry(0.068, 0.072, 0.034, 32).translate(GX(1) + 0.3048, CEIL - 0.017, GZ(4) - 0.3048));
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 3 });
  addMesh(new THREE.SphereGeometry(0.004, 8, 6).translate(GX(1) + 0.3048 + 0.04, CEIL - 0.035, GZ(4) - 0.3048), ledMat, { cast: false });
  for (const x of [-2.1, 2.1]) for (const z of [-1.6, -4.6, -7.4]) {
    put(mat.chrome, new THREE.CylinderGeometry(0.032, 0.032, 0.006, 20).translate(x, CEIL - 0.003, z), new THREE.CylinderGeometry(0.008, 0.01, 0.03, 10).translate(x, CEIL - 0.02, z),
      new THREE.CylinderGeometry(0.016, 0.016, 0.003, 14).translate(x, CEIL - 0.037, z));
  }
  {
    const px = 0, pz = -4.25;
    put(mat.darkSteel, new THREE.CylinderGeometry(0.018, 0.018, 0.36, 12).translate(px, CEIL - 0.18, pz), box(0.14, 0.012, 0.14, px, CEIL - 0.006, pz, { uv: false }), box(0.18, 0.02, 0.12, px, CEIL - 0.37, pz, { uv: false }));
    put(mat.plastic, box(0.31, 0.1, 0.25, px, CEIL - 0.43, pz, { r: 0.02, uv: false }));
    put(mat.blackPlastic, new THREE.CylinderGeometry(0.035, 0.038, 0.03, 20).rotateX(Math.PI / 2).translate(px + 0.07, CEIL - 0.43, pz - 0.135), box(0.2, 0.004, 0.16, px, CEIL - 0.481, pz, { uv: false }));
  }

  // baseboard (rubber cove base), outlets, light switch
  const bb = 0.1, bt = 0.006;
  put(mat.base, box(R.x1 - R.x0, bb, bt, 0, bb / 2, R.z0 + bt / 2, { uv: false }), box(bt, bb, R.z1 - R.z0, R.x0 + bt / 2, bb / 2, (R.z0 + R.z1) / 2, { uv: false }),
    box(bt, bb, DOOR.z0 - R.z0, R.x1 - bt / 2, bb / 2, (R.z0 + DOOR.z0) / 2, { uv: false }), box(bt, bb, R.z1 - DOOR.z1, R.x1 - bt / 2, bb / 2, (DOOR.z1 + R.z1) / 2, { uv: false }),
    box(R.x1 - R.x0, bb, bt, 0, bb / 2, R.z1 - bt / 2, { uv: false }));
  {
    const plates = [[R.x0, -2.7, Math.PI / 2], [R.x0, -5.9, Math.PI / 2], [R.x1, -2.0, -Math.PI / 2], [R.x1, -6.6, -Math.PI / 2], [-3.1, R.z0, 0], [3.4, R.z0, 0], [-1.25, R.z1, Math.PI], [1.25, R.z1, Math.PI]];
    const og = new THREE.BoxGeometry(0.07, 0.115, 0.006);
    const om = new THREE.InstancedMesh(og, std({ map: outletTexture(), roughness: 0.4 }), plates.length);
    plates.forEach(([x, z, ry], i) => { const n = V3(Math.sin(ry), 0, Math.cos(ry)); om.setMatrixAt(i, P(x + n.x * 0.003, 0.42, z + n.z * 0.003, ry)); });
    om.receiveShadow = true; scene.add(om); patchInterior(om.material);
    // double light switch by the door
    const sw = (z) => [box(0.006, 0.115, 0.12, R.x1 - 0.003, 1.22, z, { uv: false }), box(0.012, 0.022, 0.012, R.x1 - 0.01, 1.226, z - 0.025, { rz: 0.35, uv: false }), box(0.012, 0.022, 0.012, R.x1 - 0.01, 1.226, z + 0.025, { rz: 0.35, uv: false })];
    put(mat.plastic, ...sw(-5.33));
  }

  // ---------------- the door (right wall), its frame, the EXIT sign
  {
    const x = R.x1, zc = (DOOR.z0 + DOOR.z1) / 2, dw = DOOR.z1 - DOOR.z0;
    put(mat.doorFrame, box(0.17, DOOR.h + 0.05, 0.05, x + 0.075, (DOOR.h + 0.05) / 2, DOOR.z0 - 0.02, { uv: false }), box(0.17, DOOR.h + 0.05, 0.05, x + 0.075, (DOOR.h + 0.05) / 2, DOOR.z1 + 0.02, { uv: false }),
      box(0.17, 0.05, dw + 0.09, x + 0.075, DOOR.h + 0.025, zc, { uv: false }));
    // leaf with a narrow wired-glass vision lite on the latch side
    const lx = x + 0.06, t = 0.045, liteZ0 = DOOR.z1 - 0.22, liteZ1 = DOOR.z1 - 0.12, liteY0 = 1.16, liteY1 = 1.92, top = DOOR.h - 0.01;
    put(mat.wood, box(t, top, liteZ0 - DOOR.z0 - 0.005, lx, top / 2, (DOOR.z0 + 0.005 + liteZ0) / 2), box(t, top, DOOR.z1 - 0.005 - liteZ1, lx, top / 2, (liteZ1 + DOOR.z1 - 0.005) / 2),
      box(t, liteY0, liteZ1 - liteZ0, lx, liteY0 / 2, (liteZ0 + liteZ1) / 2), box(t, top - liteY1, liteZ1 - liteZ0, lx, (liteY1 + top) / 2, (liteZ0 + liteZ1) / 2));
    put(mat.darkSteel, box(0.012, liteY1 - liteY0 + 0.03, 0.015, lx - t / 2 - 0.004, (liteY0 + liteY1) / 2, liteZ0 - 0.007, { uv: false }), box(0.012, liteY1 - liteY0 + 0.03, 0.015, lx - t / 2 - 0.004, (liteY0 + liteY1) / 2, liteZ1 + 0.007, { uv: false }),
      box(0.012, 0.015, liteZ1 - liteZ0 + 0.03, lx - t / 2 - 0.004, liteY0 - 0.007, (liteZ0 + liteZ1) / 2, { uv: false }), box(0.012, 0.015, liteZ1 - liteZ0 + 0.03, lx - t / 2 - 0.004, liteY1 + 0.007, (liteZ0 + liteZ1) / 2, { uv: false }));
    const lite = addMesh(new THREE.PlaneGeometry(liteZ1 - liteZ0, liteY1 - liteY0).rotateY(-Math.PI / 2).translate(lx, (liteY0 + liteY1) / 2, (liteZ0 + liteZ1) / 2),
      std({ map: wireGlassTexture(), color: 0xdfe6ea, transparent: true, opacity: 0.55, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }), { cast: false });
    excludeFromOverride(lite);
    addMesh(new THREE.PlaneGeometry(2.6, 2.8).rotateY(-Math.PI / 2).translate(x + 1.4, 1.4, zc), new THREE.MeshBasicMaterial({ map: corridorTexture(), color: 0xbdbab2 }), { cast: false, receive: false });
    // hardware: lever handle, kick plate, closer, hinges
    const fx = lx - t / 2;
    put(mat.steel, new THREE.CylinderGeometry(0.032, 0.032, 0.012, 24).rotateZ(Math.PI / 2).translate(fx - 0.006, 1.0, DOOR.z1 - 0.07),
      new THREE.CylinderGeometry(0.009, 0.009, 0.06, 12).rotateZ(Math.PI / 2).translate(fx - 0.035, 1.0, DOOR.z1 - 0.07),
      box(0.018, 0.02, 0.13, fx - 0.062, 1.0, DOOR.z1 - 0.125, { r: 0.007, uv: false }),
      box(0.002, 0.25, dw - 0.06, fx - 0.001, 0.13, zc), ...[0.25, 1.05, 1.85].map((y) => box(0.012, 0.11, 0.022, fx + 0.004, y, DOOR.z0 + 0.008, { uv: false })));
    put(mat.darkSteel, box(0.06, 0.065, 0.28, fx - 0.03, top - 0.06, DOOR.z0 + 0.22, { r: 0.008, uv: false }), box(0.015, 0.015, 0.3, fx - 0.06, top + 0.01, DOOR.z0 + 0.42, { ry: 0.25, uv: false }));
    // EXIT sign above the door
    const exitC = cnv(512, 300); drawExit(exitC); const exitE = cnv(512, 300); exitEmissive(exitE);
    const exitMat = std({ map: ctex(exitC), emissiveMap: ctex(exitE), emissive: 0xffffff, emissiveIntensity: 2.6, roughness: 0.35 });
    put(mat.plastic, box(0.05, 0.2, 0.33, x - 0.025, 2.42, zc, { r: 0.008, uv: false }));
    addMesh(new THREE.PlaneGeometry(0.3, 0.17).rotateY(-Math.PI / 2).translate(x - 0.051, 2.42, zc), exitMat, { cast: false });
  }

  // ---------------- whiteboard on the back wall
  const board = { x0: -1.8, x1: 1.8, y0: 0.9, y1: 2.1, z: R.z0 };
  const boardC = cnv(2048, 683);
  const boardTex = ctex(boardC, { aniso: 8 });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  let boardAQI;
  const setBoard = (aqi) => { const v = aqi == null ? null : Math.round(aqi); if (v === boardAQI) return; boardAQI = v; drawWhiteboard(boardC, v, dateStr); boardTex.needsUpdate = true; };
  setBoard(null);
  const boardMat = std({ map: boardTex, roughness: 0.14, metalness: 0, envMapIntensity: 0.55 });
  put(mat.alu, box(board.x1 - board.x0 + 0.01, board.y1 - board.y0 + 0.01, 0.012, 0, (board.y0 + board.y1) / 2, board.z + 0.006, { uv: false }));
  addMesh(new THREE.PlaneGeometry(board.x1 - board.x0, board.y1 - board.y0).translate(0, (board.y0 + board.y1) / 2, board.z + 0.0125), boardMat, { cast: false });
  {
    const bw = board.x1 - board.x0, bh = board.y1 - board.y0, fz = board.z + 0.016, f = 0.028;
    put(mat.alu, box(bw + 2 * f, f, 0.03, 0, board.y1 + f / 2, fz, { r: 0.006, uv: false }), box(f, bh, 0.03, board.x0 - f / 2, (board.y0 + board.y1) / 2, fz, { r: 0.006, uv: false }),
      box(f, bh, 0.03, board.x1 + f / 2, (board.y0 + board.y1) / 2, fz, { r: 0.006, uv: false }), box(bw + 2 * f, f, 0.03, 0, board.y0 - f / 2, fz, { r: 0.006, uv: false }));
    put(mat.greyPlastic, ...[[board.x0 - f / 2, board.y1 + f / 2], [board.x1 + f / 2, board.y1 + f / 2], [board.x0 - f / 2, board.y0 - f / 2], [board.x1 + f / 2, board.y0 - f / 2]].map(([x, y]) => box(0.05, 0.05, 0.036, x, y, fz + 0.002, { r: 0.01, uv: false })));
    // marker tray (aluminium L) with markers and an eraser
    const ty = board.y0 - f - 0.012;
    put(mat.alu, box(bw * 0.86, 0.006, 0.075, 0, ty, board.z + 0.05, { uv: false }), box(bw * 0.86, 0.024, 0.006, 0, ty + 0.009, board.z + 0.088, { uv: false }), box(bw * 0.86, 0.04, 0.006, 0, ty - 0.012, board.z + 0.012, { uv: false }));
    const markerCols = [0x1b1d22, 0x1d3f9a, 0xc22a22, 0x1d7a3a];
    const marker = merge([new THREE.CylinderGeometry(0.0085, 0.0085, 0.1, 14).rotateZ(Math.PI / 2), tint(new THREE.CylinderGeometry(0.0095, 0.0095, 0.045, 14).rotateZ(Math.PI / 2).translate(0.07, 0, 0), 0xffffff), tint(new THREE.CylinderGeometry(0.004, 0.006, 0.012, 10).rotateZ(-Math.PI / 2).translate(-0.056, 0, 0), 0x333333)]
      .map((gg, k) => (k === 0 ? tint(gg, 0xdedede) : gg)));
    const mk = new THREE.InstancedMesh(marker, std({ vertexColors: true, roughness: 0.35 }), 4);
    [[-0.95, 0.02], [-0.78, -0.4], [0.52, 0.12], [0.66, -0.05]].forEach(([x, ry], i) => { mk.setMatrixAt(i, P(x, ty + 0.012, board.z + 0.05, ry)); mk.setColorAt(i, new THREE.Color(markerCols[i])); });
    mk.castShadow = mk.receiveShadow = true; scene.add(mk); patchInterior(mk.material);
    put(mat.blackPlastic, box(0.15, 0.03, 0.055, 1.05, ty + 0.025, board.z + 0.05, { r: 0.01, uv: false }));
    put(mat.greyPlastic, box(0.148, 0.012, 0.053, 1.05, ty + 0.009, board.z + 0.05, { uv: false }));
  }

  // ---------------- cork bulletin board (left wall) with papers and pins
  {
    const zc = -4.1, yc = 1.55, w = 2.4, h = 1.2, x = R.x0;
    const cork = corkTextures();
    addMesh(new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2).translate(x + 0.014, yc, zc), std({ map: cork.map, normalMap: cork.normal, roughness: 0.92 }));
    put(mat.alu, box(0.022, h + 0.05, 0.025, x + 0.011, yc, zc - w / 2 - 0.012, { r: 0.006, uv: false }), box(0.022, h + 0.05, 0.025, x + 0.011, yc, zc + w / 2 + 0.012, { r: 0.006, uv: false }),
      box(0.022, 0.025, w + 0.05, x + 0.011, yc + h / 2 + 0.012, zc, { r: 0.006, uv: false }), box(0.022, 0.025, w + 0.05, x + 0.011, yc - h / 2 - 0.012, zc, { r: 0.006, uv: false }));
    const atlasC = cnv(2048, 2040); drawPaperAtlas(atlasC, now);
    const atlas = ctex(atlasC, { aniso: 8 });
    const papers = [], pins = [], r = rng(17);
    const layout = [[0, -0.85, 0.22, 0.28], [1, -0.5, -0.18, 0.24], [2, -0.05, 0.12, 0.34], [3, 0.4, 0.26, 0.24], [4, 0.82, 0.15, 0.27], [5, 0.95, -0.28, 0.25], [6, 0.38, -0.25, 0.26], [7, -0.88, -0.3, 0.22], [9, -0.45, 0.3, 0.2], [10, 0.05, -0.33, 0.22]];
    for (const [cell, dz, dy, pw] of layout) {
      const ph = pw * 680 / 512, u0 = (cell % 4) / 4, v1 = 1 - Math.floor(cell / 4) * 680 / 2040, v0 = v1 - 680 / 2040;
      const g = new THREE.PlaneGeometry(pw, ph, 4, 4), uv = g.attributes.uv, pp = g.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, u0 + uv.getX(i) * 0.25, v0 + uv.getY(i) * (v1 - v0));
        const ex = Math.abs(pp.getX(i)) / (pw / 2), ey = Math.abs(pp.getY(i)) / (ph / 2);
        pp.setZ(i, 0.0015 + 0.006 * Math.pow(ex * ey, 3) * (pp.getY(i) < 0 ? 1.6 : 0.5));
      }
      g.computeVertexNormals();
      g.rotateZ((r() - 0.5) * 0.08).rotateY(Math.PI / 2).translate(x + 0.017, yc + dy, zc + dz);
      papers.push(g);
      pins.push([x + 0.019, yc + dy + ph / 2 - 0.02, zc + dz - pw * 0.3 * (r() < 0.5 ? 1 : 0)], [x + 0.019, yc + dy + ph / 2 - 0.02, zc + dz + pw * 0.3]);
    }
    addMesh(merge(papers), std({ map: atlas, roughness: 0.9, side: THREE.DoubleSide }), { cast: false });
    const pinGeo = merge([new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 12).rotateZ(Math.PI / 2).translate(0.006, 0, 0), new THREE.CylinderGeometry(0.0035, 0.0045, 0.007, 10).rotateZ(Math.PI / 2).translate(0.0125, 0, 0), new THREE.SphereGeometry(0.0048, 10, 8).translate(0.017, 0, 0)]);
    const pinMesh = new THREE.InstancedMesh(pinGeo, std({ roughness: 0.25 }), pins.length);
    const pinCols = [0xd62828, 0x1d4ed8, 0xf2c200, 0x16a34a, 0xffffff];
    pins.forEach(([px, py, pz], i) => { pinMesh.setMatrixAt(i, P(px, py, pz)); pinMesh.setColorAt(i, new THREE.Color(pinCols[i % pinCols.length])); });
    pinMesh.castShadow = true; scene.add(pinMesh); patchInterior(pinMesh.material);
  }

  // ---------------- posters
  {
    const pt = cnv(2048, 1300); drawPeriodicTable(pt);
    addMesh(new THREE.PlaneGeometry(1.3, 0.825).rotateY(-Math.PI / 2).translate(R.x1 - 0.004, 1.72, -2.25), std({ map: ctex(pt, { aniso: 8 }), roughness: 0.45 }), { cast: false });
    const sm = cnv(1024, 1400); drawPoster(sm, "method");
    addMesh(new THREE.PlaneGeometry(0.6, 0.82).rotateY(-Math.PI / 2).translate(R.x1 - 0.004, 1.62, -6.45), std({ map: ctex(sm), roughness: 0.5 }), { cast: false });
    const sf = cnv(1024, 1400); drawPoster(sf, "safety");
    addMesh(new THREE.PlaneGeometry(0.6, 0.82).rotateY(Math.PI / 2).translate(R.x0 + 0.004, 1.6, -6.55), std({ map: ctex(sf), roughness: 0.5 }), { cast: false });
    const fair = cnv(800, 1200); drawPoster(fair, "fair");
    addMesh(new THREE.PlaneGeometry(0.42, 0.63).rotateY(-Math.PI / 2).translate(R.x1 - 0.004, 1.5, -3.25), std({ map: ctex(fair), roughness: 0.55 }), { cast: false });
  }

  // ---------------- flag on a short wall-mounted staff (back wall, right of the board)
  {
    const base = V3(2.45, 2.02, R.z0 + 0.02), dir = V3(0.18, 0.62, 0.76).normalize(), len = 1.22;
    const tip = base.clone().addScaledVector(dir, len);
    const staff = new THREE.CylinderGeometry(0.011, 0.011, len, 12).translate(0, len / 2, 0);
    staff.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir)); staff.translate(base.x, base.y, base.z);
    put(mat.gold, staff, new THREE.SphereGeometry(0.028, 16, 12).translate(tip.x, tip.y, tip.z), box(0.06, 0.09, 0.04, base.x, base.y, base.z, { r: 0.01, uv: false }));
    const fc = cnv(1024, 540); drawFlag(fc);
    const L = 0.88, Hh = 0.58, nu = 24, nv = 14, fg = new THREE.PlaneGeometry(1, 1, nu, nv), pa = fg.attributes.position, ua = fg.attributes.uv;
    const down = V3(0, -1, 0), side = V3().crossVectors(dir, down).normalize(), hoistTop = tip.clone().addScaledVector(dir, -0.06);
    for (let i = 0; i < pa.count; i++) {
      const u = ua.getX(i), v = 1 - ua.getY(i); // u: hoist → fly, v: top of the hoist → bottom
      const p = hoistTop.clone().addScaledVector(dir, -v * Hh).addScaledVector(down, u * L * (0.96 + 0.04 * v));
      p.addScaledVector(side, Math.sin(v * 9.5 + u * 2.2) * 0.022 * (0.25 + u) + Math.sin(u * 5.0) * 0.012);
      p.addScaledVector(dir, -u * u * 0.06);
      pa.setXYZ(i, p.x, p.y, p.z); ua.setXY(i, u, 1 - v);
    }
    fg.computeVertexNormals();
    addMesh(fg, std({ map: ctex(fc), roughness: 0.82, side: THREE.DoubleSide }));
  }

  // ---------------- clock, projector screen and the rest of the glTF props
  const clockHands = {};
  const dynamic = { laptopScreen: null, lampBulb: null, plantMats: [] };
  const load = (name, fn) => kit.gltf.load(`assets/models/room/${name}.glb`, (g) => { try { fn(partsOf(g.scene)); } catch (e) { console.warn("room prop", name, e); } }, undefined, (e) => console.warn("room prop failed", name, e));
  const instanced = (parts, placements, origin, { cast = true, receive = true, colors } = {}) => {
    const out = [];
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      placements.forEach((Pm, i) => { im.setMatrixAt(i, _m.multiplyMatrices(Pm, origin).multiply(part.matrix)); if (colors) im.setColorAt(i, colors[i]); });
      im.castShadow = cast; im.receiveShadow = receive; scene.add(im); patchInterior(part.material);
      out.push(im);
    }
    return out;
  };
  const tune = (parts, fn) => parts.forEach((p) => fn(p.material));

  // student desks and chairs, 5 rows × 5, facing the board (−z)
  const COLS = [-2.35, -1.05, 0.25, 1.55, 2.85], ROWS = [-6.15, -5.08, -4.01, -2.94, -1.87];
  const DESK_S = 0.86, CHAIR_S = 0.82, DESK_TOP = 0.882 * DESK_S;
  const rr = rng(2024), desks = [];
  ROWS.forEach((z, ri) => COLS.forEach((x, ci) => desks.push({ x: x + (rr() - 0.5) * 0.07, z: z + (rr() - 0.5) * 0.08, ry: Math.PI + (rr() - 0.5) * 0.07, ri, ci })));
  load("SchoolDesk_01", (parts) => {
    tune(parts, (m) => { m.envMapIntensity = 0.7; });
    instanced(parts, desks.map((d) => P(d.x, FL, d.z, d.ry)), footprint(parts, DESK_S));
  });
  const chairs = desks.map((d, i) => {
    let push = 0.38 + rr() * 0.12, turn = (rr() - 0.5) * 0.18;
    if ([3, 11, 17].includes(i)) { push += 0.28; turn += (rr() - 0.5) * 0.9; }
    if (i === 8) { push += 0.15; turn += 1.2; }
    if (i === 21) { push += 0.4; turn -= 0.5; }
    const fwd = V3(Math.sin(d.ry), 0, Math.cos(d.ry)); // the desk's "forward" is −z after the half turn
    return { x: d.x - fwd.x * push, z: d.z - fwd.z * push, ry: d.ry + turn, desk: d };
  });
  const TEACHER = { x: 2.85, z: -7.45, ry: 2.84, s: 0.92 };
  const teacherChair = { x: TEACHER.x + Math.sin(TEACHER.ry) * 0.72, z: TEACHER.z + Math.cos(TEACHER.ry) * 0.72, ry: TEACHER.ry + Math.PI + 0.35 };
  load("SchoolChair_01", (parts) => {
    tune(parts, (m) => { m.envMapIntensity = 0.8; });
    instanced(parts, [...chairs, teacherChair].map((c) => P(c.x, FL, c.z, c.ry)), footprint(parts, CHAIR_S));
  });

  // the teacher's corner
  const onDesk = (lx, lz, extra = 0, h = 0) => { // teacher desk local → world placement
    const c = Math.cos(TEACHER.ry), s = Math.sin(TEACHER.ry);
    return [TEACHER.x + lx * c + lz * s, FL + 0.787 * TEACHER.s + h, TEACHER.z - lx * s + lz * c, TEACHER.ry + extra];
  };
  load("metal_office_desk", (parts) => instanced(parts, [P(TEACHER.x, FL, TEACHER.z, TEACHER.ry)], footprint(parts, TEACHER.s)));
  load("classic_laptop", (parts) => {
    const screen = parts.find((p) => p.material.name === "classic_laptop_screen");
    const sc = cnv(512, 420); drawLaptopScreen(sc);
    if (screen) {
      screen.material = new THREE.MeshStandardMaterial({ map: ctex(sc), emissiveMap: ctex(sc), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.25 });
      dynamic.laptopScreen = screen.material;
    }
    const [x, y, z, ry] = onDesk(-0.28, 0.12, 0.22);
    instanced(parts, [P(x, y, z, ry)], footprint(parts, 0.55));
  });
  load("desk_lamp_arm_01", (parts) => {
    const bulb = parts.find((p) => p.material.name.endsWith("_light"));
    if (bulb) { bulb.material = bulb.material.clone(); bulb.material.emissive = new THREE.Color(0xffd9a0); bulb.material.emissiveIntensity = 0; dynamic.lampBulb = bulb.material; }
    const [x, y, z, ry] = onDesk(0.74, -0.36, Math.PI - 0.5);
    const b = boundsOf(parts), c = b.getCenter(V3());
    instanced(parts, [P(x, y, z, ry)], new THREE.Matrix4().makeScale(0.8, 0.8, 0.8).multiply(new THREE.Matrix4().makeTranslation(-c.x, 0, -b.max.z + 0.04)));
  });
  load("office_notepads", ([part]) => {
    const pick = (x0, x1, z0, z1) => extract(part, (c) => c.x > x0 && c.x < x1 && c.z > z0 && c.z < z1);
    const pad = pick(0.03, 0.27, -0.34, -0.01), stack = pick(-0.56, -0.34, -0.33, -0.02), sheetA = pick(-0.56, -0.34, 0.02, 0.33), sheetB = pick(-0.26, -0.04, 0.02, 0.33), sticky = pick(0.4, 0.5, 0.04, 0.13);
    const put1 = (p, pl) => instanced([p], pl, footprint([p]), { cast: false });
    put1(pad, [P(...onDesk(0.28, 0.16, 0.3)), P(desks[7].x + 0.08, DESK_TOP, desks[7].z + 0.03, 0.4)]);
    put1(stack, [P(...onDesk(0.02, 0.05, -0.15)), P(...onDesk(0.04, 0.03, 0.4, 0.012))]);
    put1(sticky, [P(...onDesk(-0.02, -0.22, 0.1))]);
    // loose worksheets on students' desks
    const sheetDesks = [0, 2, 6, 9, 12, 13, 16, 19, 22, 24];
    put1(sheetA, sheetDesks.map((di, k) => P(desks[di].x + (rr() - 0.5) * 0.18, DESK_TOP + 0.001 * (k % 2), desks[di].z + (rr() - 0.5) * 0.1, rr() * 6.28)));
    put1(sheetB, [4, 12, 18, 23].map((di) => P(desks[di].x - 0.1, DESK_TOP + 0.002, desks[di].z - 0.04, rr() * 0.8)));
  });
  load("binder_notebook", ([part]) => {
    const open = extract(part, (c) => c.x < 0.23), closed = extract(part, (c) => c.x > 0.23);
    instanced([open], [P(...onDesk(-0.62, 0.08, -0.1))], footprint([open]), { cast: false });
    instanced([closed], [P(...onDesk(0.5, -0.05, 0.05)), P(R.x0 + 0.24, 0.0, -1.18, 1.6)], footprint([closed]));
  });
  load("stationery_supplies", ([part]) => {
    const sub = (x0, x1, y0, y1) => extract(part, (c) => c.x > x0 && c.x < x1 && c.y > y0 && c.y < y1);
    const cup = extract(part, (c) => c.x > 0.05 && c.y < 0.012 && c.y > -0.08);
    const pencils = [sub(-0.17, 0.035, -0.023, -0.011), sub(-0.16, 0.025, -0.047, -0.035), sub(-0.13, 0, -0.068, -0.056), sub(-0.11, -0.01, 0.081, 0.093)];
    const pens = [sub(-0.14, 0.006, 0.002, 0.014), sub(-0.15, 0.017, 0.027, 0.041), sub(-0.14, -0.004, 0.056, 0.074)];
    const eraser = extract(part, (c) => c.x > 0.07 && c.y > 0.05);
    const [cx, cy, cz] = onDesk(0.62, 0.16);
    instanced([cup], [P(cx, cy, cz, 0)], footprint([cup]));
    // pens standing in the cup
    [...pens, pencils[0], pencils[1]].forEach((p, k) => {
      const a = k / 5 * 6.28, b = boundsOf([p]), len = b.max.x - b.min.x;
      instanced([p], [P(cx + Math.cos(a) * 0.016, cy + 0.005 + len / 2, cz + Math.sin(a) * 0.016, a, 1, 0, Math.PI / 2 + 0.12 * Math.cos(a))], footprint([p]), { cast: false });
    });
    // pencils and pens lying on students' desks
    const lying = [1, 3, 5, 7, 8, 10, 12, 14, 15, 17, 20, 21, 23];
    lying.forEach((di, k) => {
      const p = k % 3 === 0 ? pens[k % pens.length] : pencils[k % pencils.length];
      instanced([p], [P(desks[di].x + (rr() - 0.5) * 0.3, DESK_TOP, desks[di].z + (rr() - 0.5) * 0.16, rr() * 6.28)], footprint([p]), { cast: false });
    });
    instanced([eraser], [P(desks[12].x + 0.12, DESK_TOP, desks[12].z + 0.1, 0.4)], footprint([eraser]), { cast: false });
  });
  load("drawer_cabinet", (parts) => instanced(parts, [P(-3.35, FL, R.z0 + 0.25, 0)], footprint(parts, 0.95)));
  load("cardboard_box_01", (parts) => instanced(parts, [P(-3.15, FL + 1.881 * 0.95, R.z0 + 0.28, 0.08), P(-4.18, FL, -7.95, 1.4)], footprint(parts, 0.95)));
  load("metal_trash_can", (parts) => {
    const can = parts[0].material.name === "metal_trash_can" ? parts[0] : parts[1];
    const body = extract(can, (c) => c.x > 0.198 || c.y > 0.62); // the clean can and its handles, not the lid leaning on it
    instanced([body], [P(4.12, FL, -6.75, Math.PI + 0.3)], footprint([body], 0.5));
  });
  {
    // the projection screen, rolled up in its case above the board (the screen's bottom bar and pull cord peek out)
    const cy = board.y1 + 0.2, cz = R.z0 + 0.075, cw = 2.5;
    put(mat.enamel, new THREE.CylinderGeometry(0.048, 0.048, cw, 28).rotateZ(Math.PI / 2).translate(0, cy, cz), box(cw, 0.07, 0.05, 0, cy + 0.012, cz - 0.03, { r: 0.012, uv: false }));
    put(mat.greyPlastic, ...[-1, 1].map((sx) => new THREE.CylinderGeometry(0.052, 0.052, 0.035, 28).rotateZ(Math.PI / 2).translate(sx * (cw / 2 + 0.016), cy, cz)),
      ...[-1, 1].map((sx) => box(0.05, 0.11, 0.07, sx * (cw / 2 - 0.15), cy + 0.02, R.z0 + 0.035, { uv: false })));
    put(mat.blackPlastic, box(cw - 0.16, 0.018, 0.02, 0, cy - 0.054, cz + 0.006, { r: 0.006, uv: false }));
    put(mat.cordDark ?? mat.blackPlastic, new THREE.CylinderGeometry(0.002, 0.002, 0.2, 5).translate(0, cy - 0.16, cz + 0.006), new THREE.TorusGeometry(0.016, 0.004, 6, 16).translate(0, cy - 0.275, cz + 0.006));
  }
  load("wall_clock", (parts) => {
    const body = parts.find((p) => p.material.name === "wall_clock"), glass = parts.find((p) => p.material.name !== "wall_clock");
    const noHands = extract(body, (c) => !(c.z > 0.02 && Math.hypot(c.x, c.y) < 0.135));
    const at = P(0, 2.67, R.z0 + 0.001, 0, 1.0);
    instanced([noHands], [at], new THREE.Matrix4());
    if (glass) {
      const gm = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, depthWrite: false });
      const [g] = instanced([{ ...glass, material: gm }], [at], new THREE.Matrix4(), { cast: false }); excludeFromOverride(g); g.renderOrder = 3;
    }
    const handMat = std({ color: 0x15161a, roughness: 0.5 }), redMat = std({ color: 0xc8261e, roughness: 0.4 });
    const hand = (len, w0, w1, tail) => { const s = new THREE.Shape(); s.moveTo(-w0 / 2, -tail); s.lineTo(w0 / 2, -tail); s.lineTo(w1 / 2, len); s.lineTo(-w1 / 2, len); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: 0.0018, bevelEnabled: false }); };
    const group = new THREE.Group(); group.applyMatrix4(at); scene.add(group);
    const mkHand = (geo, m, z) => { const h = new THREE.Mesh(geo, m); h.position.z = z; h.castShadow = true; group.add(h); patchInterior(m); return h; };
    clockHands.h = mkHand(hand(0.072, 0.011, 0.007, 0.018), handMat, 0.026);
    clockHands.m = mkHand(hand(0.108, 0.009, 0.005, 0.02), handMat, 0.0285);
    clockHands.s = mkHand(merge([hand(0.114, 0.0028, 0.0018, 0.032), new THREE.CircleGeometry(0.006, 16).translate(0, -0.026, 0.0018)]), redMat, 0.031);
    mkHand(new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 16).rotateX(Math.PI / 2), redMat, 0.034);
  });
  load("fire_alarm", (parts) => instanced(parts, [P(R.x1, 1.22, -3.9, -Math.PI / 2)], new THREE.Matrix4(), { cast: false }));

  // shelves (left wall by the windows) with books, binders and a plant
  const SHELF = { x: R.x0 + 0.225, z: -1.42, ry: Math.PI / 2, s: 1.83 / 21.4 };
  let shelfLevels = [0.08, 0.5, 0.93, 1.36, 1.79];
  const shelfReady = new Promise((res) => load("steel_frame_shelves_01", (parts) => {
    instanced(parts, [P(SHELF.x, FL, SHELF.z, SHELF.ry)], footprint(parts, SHELF.s));
    // find the board tops: upward-facing vertices clustered by height
    const p = parts[0], pos = p.geometry.attributes.position, nrm = p.geometry.attributes.normal, v = V3(), n = V3(), hist = new Map();
    const nm = new THREE.Matrix3().getNormalMatrix(p.matrix), b = boundsOf(parts);
    for (let i = 0; i < pos.count; i++) {
      n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize(); if (n.y < 0.95) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix); const k = Math.round((v.y - b.min.y) * SHELF.s * 100); hist.set(k, (hist.get(k) || 0) + 1);
    }
    const peaks = [...hist.entries()].filter(([, c]) => c > 12).map(([k]) => k / 100).sort((a, c) => a - c);
    const lv = []; for (const y of peaks) if (!lv.length || y - lv[lv.length - 1] > 0.15) lv.push(y); else lv[lv.length - 1] = Math.max(lv[lv.length - 1], y);
    if (lv.length >= 4) shelfLevels = lv;
    res();
  }));
  const shelfAt = (level, along, depth = 0) => [SHELF.x + depth, FL + shelfLevels[Math.min(level, shelfLevels.length - 1)], SHELF.z + along];
  load("book_encyclopedia_set_01", (parts) => shelfReady.then(() => {
    const full = footprint(parts);
    instanced(parts, [P(...shelfAt(3, 0.12, 0.02), Math.PI / 2)], full);
    const half = parts.map((p) => extract(p, (c) => c.x < 0.29));
    instanced(half, [P(...shelfAt(1, -0.2, 0.02), Math.PI / 2)], footprint(half));
  }));
  // school binders and magazine boxes
  shelfReady.then(() => {
    const bg = new RoundedBoxGeometry(0.29, 0.3, 0.055, 2, 0.006);
    const bm = new THREE.InstancedMesh(bg, mat.vinyl, 14), labels = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.03, 0.12), mat.paper, 14);
    const cols = [0x1d4ed8, 0xb91c1c, 0x15803d, 0x111827, 0x7c3aed, 0xf59e0b, 0x0f766e, 0xbe185d];
    let k = 0; const r = rng(55);
    const binderAt = (level, along, lean = 0) => {
      const [x, y, z] = shelfAt(level, along, 0.01);
      bm.setMatrixAt(k, P(x, y + 0.15, z, 0, 1, lean)); bm.setColorAt(k, new THREE.Color(cols[(k * 3) % cols.length]).multiplyScalar(0.8 + r() * 0.3));
      labels.setMatrixAt(k, P(x + 0.146, y + 0.17, z + Math.sin(lean) * 0.0, Math.PI / 2, 1, lean)); k++;
    };
    for (let i = 0; i < 5; i++) binderAt(3, -0.39 + i * 0.058);
    for (let i = 0; i < 6; i++) binderAt(2, -0.3 + i * 0.058, i === 5 ? -0.25 : 0);
    for (let i = 0; i < 3; i++) binderAt(1, 0.18 + i * 0.058);
    bm.count = labels.count = k;
    bm.castShadow = bm.receiveShadow = true; scene.add(bm, labels); patchInterior(mat.vinyl); patchInterior(mat.paper);
    // two plastic storage tubs on the bottom shelf
    const tub = new RoundedBoxGeometry(0.4, 0.22, 0.32, 2, 0.02);
    const tubs = new THREE.InstancedMesh(tub, std({ roughness: 0.5 }), 2);
    [[-0.22, 0x2563eb], [0.22, 0x6b7280]].forEach(([a, c], i) => { const [x, y, z] = shelfAt(0, a, 0); tubs.setMatrixAt(i, P(x, y + 0.111, z, Math.PI / 2)); tubs.setColorAt(i, new THREE.Color(c)); });
    tubs.castShadow = tubs.receiveShadow = true; scene.add(tubs); patchInterior(tubs.material);
  });

  // potted calatheas: one on the windowsill beside the device, one on top of the shelves
  const potParts = new Promise((res) => load("planter_pot_clay", res));
  load("calathea_orbifolia_01", ([part]) => {
    tune([part], (m) => { m.envMapIntensity = 0.6; dynamic.plantMats.push(m); });
    const plantB = extract(part, (c) => c.x > -0.25 && c.x < 0.25 && c.z < 0.3), plantA = extract(part, (c) => c.x < -0.6);
    Promise.all([potParts, shelfReady]).then(([pot]) => {
      const pb = boundsOf(pot), potH = pb.max.y - pb.min.y, potR = (pb.max.x - pb.min.x) / 2;
      const plant = (p, x, y, z, s, ry, plantS) => {
        instanced(pot, [P(x, y, z, ry)], footprint(pot, s));
        put(mat.soil, new THREE.CircleGeometry(potR * 0.86 * s, 24).rotateX(-Math.PI / 2).translate(x, y + potH * s * 0.9, z));
        instanced([p], [P(x, y + potH * s * 0.82, z, ry)], footprint([p], plantS));
      };
      plant(plantB, -0.43, SILL, -0.31, 0.68, 0.6, 0.78);
      const [sx, sy, sz] = shelfAt(9, 0.22, 0.0);
      plant(plantA, sx, sy, sz, 0.95, 2.2, 0.95);
      flushLate();
    });
  });

  // ---------------- procedural clutter: backpacks, bottles, notebooks, pencil cases, a mug
  {
    // backpack: a soft rounded body with a front pocket, straps and a grab handle
    const body = new RoundedBoxGeometry(0.3, 0.42, 0.15, 4, 0.06), bp = body.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i), t = (y + 0.21) / 0.42;
      bp.setX(i, bp.getX(i) * (1 - 0.14 * t * t)); bp.setZ(i, bp.getZ(i) * (1.12 - 0.3 * t) + (bp.getZ(i) > 0 ? 0.012 * Math.sin(t * Math.PI) : 0));
    }
    body.computeVertexNormals(); body.translate(0, 0.21, 0);
    const pocket = new RoundedBoxGeometry(0.24, 0.17, 0.06, 3, 0.025).translate(0, 0.12, 0.085);
    const strapPts = (sx) => [V3(sx, 0.38, -0.08), V3(sx * 1.05, 0.3, -0.115), V3(sx * 1.1, 0.16, -0.12), V3(sx * 1.2, 0.04, -0.09)];
    const straps = [-0.075, 0.075].map((sx) => tint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strapPts(sx)), 12, 0.012, 5).scale(1, 1, 0.55), 0x2a2a2a));
    const handle = tint(new THREE.TorusGeometry(0.035, 0.007, 6, 14, Math.PI).translate(0, 0.42, -0.02), 0x2a2a2a);
    const zip = tint(new THREE.TorusGeometry(0.13, 0.004, 4, 30, Math.PI).scale(1, 1.25, 1).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.27, 0.0), 0x555555);
    const bag = merge([tint(body, 0xffffff), tint(pocket, 0xe8e8e8), ...straps, handle, zip]);
    const bagCols = [0x1f2a44, 0x8a1c1c, 0x2f3437, 0x0f5e63, 0x4b3f72, 0x6b6f2a, 0x9a5a1a, 0x1a1a1a];
    const bagSpots = [];
    // hung on chair backs
    [2, 6, 13, 19, 23].forEach((ci) => { const c = chairs[ci]; const bk = V3(Math.sin(c.ry), 0, Math.cos(c.ry)); bagSpots.push(P(c.x - bk.x * 0.2, FL + 0.37, c.z - bk.z * 0.2, c.ry + Math.PI, 0.95, 0.1)); });
    // on the floor beside desks
    [[0, 0.42, 0.3, 1.45], [9, -0.42, 0.1, -1.4], [16, 0.42, -0.1, 1.2], [21, -0.4, 0.15, -1.7]].forEach(([di, dx, dz, lean]) => { const d = desks[di]; bagSpots.push(P(d.x + dx, FL + (Math.abs(lean) > 1.3 ? 0.118 : 0), d.z + dz, rr() * 6.28, 0.95, Math.abs(lean) > 1.3 ? lean : 0.12)); });
    const bags = new THREE.InstancedMesh(bag, mat.fabric, bagSpots.length);
    bagSpots.forEach((m, i) => { bags.setMatrixAt(i, m); bags.setColorAt(i, new THREE.Color(bagCols[i % bagCols.length])); });
    bags.castShadow = bags.receiveShadow = true; scene.add(bags); patchInterior(mat.fabric);

    // insulated bottles
    const prof = [[0, 0], [0.036, 0], [0.038, 0.006], [0.038, 0.2], [0.034, 0.215], [0.026, 0.225], [0.026, 0.235], [0, 0.235]].map(([x, y]) => new THREE.Vector2(x, y));
    const bottleGeo = merge([tint(new THREE.LatheGeometry(prof, 28), 0xffffff), tint(new THREE.CylinderGeometry(0.028, 0.028, 0.035, 24).translate(0, 0.252, 0), 0x202020), tint(new THREE.TorusGeometry(0.012, 0.004, 6, 14).translate(0, 0.275, 0), 0x202020)]);
    const bottleCols = [0x2b9a8f, 0x1b1d22, 0xe9e6df, 0xd9779b, 0x3b6fd6, 0x7a8a2a];
    const bottleSpots = [P(desks[1].x + 0.2, DESK_TOP, desks[1].z - 0.12), P(desks[7].x - 0.22, DESK_TOP, desks[7].z - 0.1), P(desks[11].x + 0.2, DESK_TOP, desks[11].z + 0.1), P(desks[18].x - 0.2, DESK_TOP, desks[18].z - 0.1), P(desks[22].x + 0.36, FL, desks[22].z + 0.18), P(...onDesk(-0.78, -0.25))];
    const bottles = new THREE.InstancedMesh(bottleGeo, mat.bottle, bottleSpots.length);
    bottleSpots.forEach((m, i) => { bottles.setMatrixAt(i, m); bottles.setColorAt(i, new THREE.Color(bottleCols[i % bottleCols.length])); });
    bottles.castShadow = bottles.receiveShadow = true; scene.add(bottles); patchInterior(mat.bottle);

    // spiral notebooks (cover + page block) and zip pencil cases
    const nbDesks = [0, 3, 4, 7, 10, 11, 14, 15, 18, 20, 22, 24];
    const cover = new THREE.InstancedMesh(new RoundedBoxGeometry(0.215, 0.004, 0.28, 1, 0.0015), std({ roughness: 0.55 }), nbDesks.length * 2);
    const pages = new THREE.InstancedMesh(new THREE.BoxGeometry(0.205, 0.008, 0.272), mat.paper, nbDesks.length);
    const nbCols = [0x1d4ed8, 0xdc2626, 0x16a34a, 0x111827, 0x9333ea, 0xf59e0b];
    nbDesks.forEach((di, i) => {
      const d = desks[di], x = d.x + (rr() - 0.5) * 0.16, z = d.z + (rr() - 0.5) * 0.08, ry = d.ry + (rr() - 0.5) * 0.6, col = new THREE.Color(nbCols[i % nbCols.length]);
      cover.setMatrixAt(i * 2, P(x, DESK_TOP + 0.002, z, ry)); cover.setMatrixAt(i * 2 + 1, P(x, DESK_TOP + 0.014, z, ry));
      cover.setColorAt(i * 2, col); cover.setColorAt(i * 2 + 1, col);
      pages.setMatrixAt(i, P(x + 0.004, DESK_TOP + 0.008, z, ry));
    });
    cover.castShadow = cover.receiveShadow = pages.receiveShadow = true; scene.add(cover, pages); patchInterior(cover.material);
    const pcDesks = [2, 6, 9, 13, 17, 21];
    const pcases = new THREE.InstancedMesh(new RoundedBoxGeometry(0.2, 0.055, 0.075, 3, 0.024), std({ roughness: 0.75 }), pcDesks.length);
    const pcCols = [0x334155, 0xbe185d, 0x0e7490, 0x4d7c0f, 0x1e1b4b, 0x9a3412];
    pcDesks.forEach((di, i) => { const d = desks[di]; pcases.setMatrixAt(i, P(d.x + (rr() - 0.5) * 0.3, DESK_TOP + 0.027, d.z + 0.12, rr() * 0.8)); pcases.setColorAt(i, new THREE.Color(pcCols[i])); });
    pcases.castShadow = pcases.receiveShadow = true; scene.add(pcases); patchInterior(pcases.material);

    // the teacher's coffee mug
    const [mx, my, mz] = onDesk(0.36, 0.26);
    put(mat.ceramic, new THREE.LatheGeometry([[0, 0], [0.038, 0], [0.041, 0.004], [0.041, 0.095], [0.037, 0.095], [0.035, 0.008], [0, 0.008]].map(([x, y]) => new THREE.Vector2(x, y)), 28).translate(mx, my, mz),
      new THREE.TorusGeometry(0.026, 0.006, 8, 16, Math.PI * 1.1).rotateZ(-Math.PI * 0.55).translate(mx + 0.042, my + 0.05, mz));
  }

  // ---------------- outside: lawn, planting bed, sidewalk, shrubs, trees
  const grassTile = [2.2, 2.2];
  const lawnMat = kit.pbr("grass", { tile: grassTile, color: 0xcfe0a8, envMapIntensity: 0.4 });
  lawnMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvLW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
      varying vec3 vLW;
      float lh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float ln(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(lh(i), lh(i + vec2(1,0)), f.x), mix(lh(i + vec2(0,1)), lh(i + vec2(1,1)), f.x), f.y); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
      { float n = ln(vLW.xz * 0.06) * 0.6 + ln(vLW.xz * 0.23) * 0.4; float d = length(vLW.xz - cameraPosition.xz);
        float big = ln(vLW.xz * 0.012 + 3.0), stripe = step(0.5, fract(vLW.x / 4.6 + 0.25)) - 0.5;
        float worn = smoothstep(0.66, 0.86, ln(vLW.xz * 0.09 + 11.0)) * smoothstep(0.35, 0.6, ln(vLW.xz * 0.5));
        diffuseColor.rgb *= mix(0.78, 1.16, n) * mix(0.86, 1.1, big) * (1.0 + stripe * 0.1 * smoothstep(4.0, 12.0, vLW.z));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.08, 0.72), worn * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.28, 0.11), smoothstep(30.0, 160.0, d) * 0.4); }`);
  };
  addMesh(worldUV(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2).translate(0, R.ground, 300)), lawnMat, { cast: false });
  const mulchMat = std({ map: mulchTexture(), roughness: 1 });
  const walkMat = std({ map: concreteTexture(true, kit.aniso), roughness: 0.92 });
  addMesh(worldUV(new THREE.PlaneGeometry(28, 0.9).rotateX(-Math.PI / 2).translate(0, R.ground + 0.012, 0.6)), mulchMat, { cast: false });
  addMesh(worldUV(box(28, 0.08, 1.5, 0, R.ground - 0.02, 1.8)), walkMat, { cast: false });
  kit.outdoor.push(lawnMat, mulchMat, walkMat);

  const leafMat = std({ map: leafTexture(false), alphaTest: 0.45, alphaToCoverage: high, vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.6 });
  const shrubMat = std({ map: leafTexture(true), alphaTest: 0.45, alphaToCoverage: high, vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, envMapIntensity: 0.5 });
  kit.outdoor.push(leafMat, shrubMat);
  /** a canopy of crossed leaf cards with normals pointing out of the crown (soft, volumetric shading) */
  function canopy(seed, cards, rx, ry, rz, cy, size) {
    const r = rng(seed), geos = [];
    for (let i = 0; i < cards; i++) {
      const u = r() * 6.28, v = Math.acos(2 * r() - 1), k = Math.cbrt(r()) * 0.9 + 0.1;
      const c = V3(Math.sin(v) * Math.cos(u) * rx * k, Math.cos(v) * ry * k + cy, Math.sin(v) * Math.sin(u) * rz * k);
      const s = size * (0.7 + r() * 0.6), g = new THREE.PlaneGeometry(s, s);
      g.rotateX((r() - 0.5) * 2.2).rotateY(r() < 0.6 ? (r() - 0.5) * 1.4 : r() * 6.28).rotateZ((r() - 0.5) * 0.8).translate(c.x, c.y, c.z);
      const pa = g.attributes.position, na = g.attributes.normal;
      for (let j = 0; j < pa.count; j++) { const n = V3(pa.getX(j), (pa.getY(j) - cy) * 0.8 + ry * 0.3, pa.getZ(j)).normalize(); na.setXYZ(j, n.x, n.y, n.z); }
      const shade = 0.32 + 0.6 * k + 0.16 * (c.y - cy) / ry;
      geos.push(tint(g, new THREE.Color(shade, shade, shade)));
    }
    return merge(geos);
  }
  {
    const r = rng(99), trees = [];
    // a few nearer trees well off to the sides, then a dense tree line across the far edge of the field
    for (let i = 0; i < 10; i++) { const side = i % 2 ? 1 : -1; trees.push([side * (24 + r() * 50), 58 + r() * 30, 0.85 + r() * 0.3]); }
    for (let i = 0; i < 110; i++) trees.push([(r() - 0.5) * 460, 105 + r() * 90 + Math.sin(i * 0.7) * 10, 0.8 + r() * 0.55]);
    const kinds = [canopy(1, 200, 4.6, 3.8, 4.6, 8.6, 2.1), canopy(2, 170, 3.6, 4.9, 3.6, 9.2, 2.0), canopy(3, 120, 2.4, 6.0, 2.4, 7.8, 1.8)];
    const trunk = merge([new THREE.CylinderGeometry(0.13, 0.27, 7.2, 7).translate(0, 3.6, 0), new THREE.CylinderGeometry(0.05, 0.11, 3.4, 5).rotateZ(0.65).translate(0.95, 6.0, 0), new THREE.CylinderGeometry(0.045, 0.1, 3.2, 5).rotateZ(-0.7).rotateY(2).translate(-0.55, 6.3, 0.75)]);
    const trunks = new THREE.InstancedMesh(trunk, std({ color: 0x3a332c, roughness: 0.95 }), trees.length);
    const crowns = kinds.map((g) => new THREE.InstancedMesh(g, leafMat, trees.length));
    const counts = [0, 0, 0];
    const greens = [0xffffff, 0xe2efd6, 0xf2f0c8, 0xd6e6dc, 0xf5e6a8, 0xe8f5d0, 0xcfdcc4, 0xfff0b0];
    trees.forEach(([x, z, s], i) => {
      const k = i % 7 === 3 ? 2 : i % 2;
      const m = P(x, R.ground, z, r() * 6.28, s * (0.9 + r() * 0.3));
      trunks.setMatrixAt(i, m);
      crowns[k].setMatrixAt(counts[k], m); crowns[k].setColorAt(counts[k], new THREE.Color(greens[(i * 5) % greens.length]).multiplyScalar(0.82 + r() * 0.26)); counts[k]++;
    });
    crowns.forEach((c, k) => { c.count = counts[k]; c.userData.noAO = true; excludeFromOverride(c); scene.add(c); });
    scene.add(trunks); kit.outdoor.push(trunks.material);
    // shrubs in the bed along the wall
    const shrubGeo = canopy(7, 16, 0.5, 0.36, 0.38, 0.34, 0.5);
    const spots = [];
    for (let x = -13.2; x < 13.5; x += 0.95 + r() * 0.3) if (Math.abs(x - 4.85) > 0.5) spots.push(x);
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, spots.length);
    spots.forEach((x, i) => { shrubs.setMatrixAt(i, P(x, R.ground, 0.62 + (r() - 0.5) * 0.12, r() * 6.28, 0.85 + r() * 0.35)); shrubs.setColorAt(i, new THREE.Color(0xd8e8c8).multiplyScalar(0.8 + r() * 0.3)); });
    shrubs.castShadow = true; shrubs.receiveShadow = true; shrubs.userData.noAO = true; excludeFromOverride(shrubs); scene.add(shrubs);
  }

  // ---------------- middle distance seen through the windows
  {
    const G = R.ground, r = rng(321);
    // a walk along the building, a curb, and a path out to the parking lot
    put(walkMat, worldUV(box(60, 0.06, 2.2, -4, G + 0.0, 11.2)), worldUV(box(2.0, 0.06, 21.6, -7.5, G + 0.0, 22.0)));
    const curb = std({ map: concreteTexture(false, kit.aniso), color: 0xd8d4cb, roughness: 0.85 });
    put(curb, worldUV(box(28, 0.16, 0.16, 0, G + 0.06, 2.6)));
    // parking lot (asphalt with painted stalls) ringed by a curb
    const lot = { x0: -38, x1: 26, z0: 33, z1: 53 };
    const lc = cnv(2048, 640), lg = lc.getContext("2d"), lw = lot.x1 - lot.x0, ld = lot.z1 - lot.z0, ppm = 2048 / lw;
    lg.fillStyle = "#3d3f42"; lg.fillRect(0, 0, 2048, 640);
    for (let i = 0; i < 26000; i++) { lg.fillStyle = `rgba(${r() < 0.5 ? "20,20,22" : "120,120,118"},${0.18 + r() * 0.25})`; lg.fillRect(r() * 2048, r() * 640, 1.5, 1.5); }
    for (let i = 0; i < 40; i++) { lg.fillStyle = `rgba(20,20,20,${0.06 + r() * 0.08})`; lg.beginPath(); lg.ellipse(r() * 2048, r() * 640, 20 + r() * 60, 8 + r() * 20, r(), 0, 7); lg.fill(); }
    lg.fillStyle = "rgba(235,232,220,0.85)";
    for (let x = 1; x < lw; x += 2.7) { lg.fillRect(x * ppm, 0, 0.12 * ppm, 5.4 * ppm); lg.fillRect(x * ppm, (ld - 5.4) * ppm, 0.12 * ppm, 5.4 * ppm); }
    lg.fillStyle = "rgba(230,190,40,0.8)"; lg.fillRect(0, (ld / 2 - 0.06) * ppm, 2048, 0.12 * ppm);
    const lotTex = ctex(lc, { aniso: kit.aniso });
    const lotMat = std({ map: lotTex, roughness: 0.82 });
    addMesh(new THREE.PlaneGeometry(lw, ld).rotateX(-Math.PI / 2).translate((lot.x0 + lot.x1) / 2, G + 0.035, (lot.z0 + lot.z1) / 2), lotMat, { cast: false });
    put(curb, worldUV(box(lw + 0.3, 0.15, 0.15, (lot.x0 + lot.x1) / 2, G + 0.06, lot.z0)), worldUV(box(lw + 0.3, 0.15, 0.15, (lot.x0 + lot.x1) / 2, G + 0.06, lot.z1)),
      worldUV(box(0.15, 0.15, ld, lot.x0, G + 0.06, (lot.z0 + lot.z1) / 2)), worldUV(box(0.15, 0.15, ld, lot.x1, G + 0.06, (lot.z0 + lot.z1) / 2)));
    // simple cars nosed into the stalls
    const bodyG = new RoundedBoxGeometry(4.4, 0.66, 1.76, 3, 0.16), bpos = bodyG.attributes.position, bcol = new Float32Array(bpos.count * 3);
    for (let i = 0; i < bpos.count; i++) { const dark = bpos.getY(i) < -0.12 ? 0.12 : 1; bcol.set([dark, dark, dark], i * 3); }
    bodyG.setAttribute("color", new THREE.BufferAttribute(bcol, 3)); bodyG.translate(0, 0.7, 0);
    const cabG = new RoundedBoxGeometry(2.5, 0.62, 1.6, 3, 0.2), cp = cabG.attributes.position;
    for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) { cp.setX(i, cp.getX(i) * 0.82 - 0.1); cp.setZ(i, cp.getZ(i) * 0.9); }
    cabG.computeVertexNormals(); cabG.translate(-0.25, 1.24, 0);
    const wheelG = merge([-1.4, 1.35].flatMap((x) => [-0.8, 0.8].map((z) => new THREE.CylinderGeometry(0.34, 0.34, 0.22, 18).rotateX(Math.PI / 2).translate(x, 0.34, z))));
    const spots = [];
    for (let x = lot.x0 + 2.4; x < lot.x1 - 2; x += 2.7) {
      if (r() < 0.55) spots.push([x, lot.z0 + 2.75, -Math.PI / 2 + (r() - 0.5) * 0.06]);
      if (r() < 0.45) spots.push([x, lot.z1 - 2.75, Math.PI / 2 + (r() - 0.5) * 0.06]);
    }
    const carCols = [0xd9d9d6, 0x1c1d20, 0x6f757b, 0x23365c, 0x6c1a1a, 0x9ea3a8, 0x2f3a30, 0x8a8478, 0x0f2a3d, 0x2a2b2e];
    const carPaint = std({ roughness: 0.3, metalness: 0.5, vertexColors: true }), carGlass = std({ color: 0x14181d, roughness: 0.08, metalness: 0.6 }), tire = std({ color: 0x151515, roughness: 0.85 });
    const bodies = new THREE.InstancedMesh(bodyG, carPaint, spots.length), cabs = new THREE.InstancedMesh(cabG, carGlass, spots.length), wheels = new THREE.InstancedMesh(wheelG, tire, spots.length);
    spots.forEach(([x, z, ry], i) => { const m = P(x, G + 0.04, z, ry, 0.98 + r() * 0.06); bodies.setMatrixAt(i, m); cabs.setMatrixAt(i, m); wheels.setMatrixAt(i, m); bodies.setColorAt(i, new THREE.Color(carCols[(i * 7) % carCols.length])); });
    [bodies, cabs, wheels].forEach((m) => { m.receiveShadow = true; scene.add(m); });
    kit.outdoor.push(carPaint, carGlass, tire, lotMat, curb);
    // light poles
    const poleG = merge([new THREE.CylinderGeometry(0.07, 0.11, 8, 10).translate(0, 4, 0), box(1.3, 0.08, 0.08, 0.6, 7.9, 0, { uv: false }), box(0.6, 0.14, 0.3, 1.25, 7.85, 0, { r: 0.04, uv: false }), new THREE.CylinderGeometry(0.28, 0.32, 0.5, 12).translate(0, 0.25, 0)]);
    const poleSpots = [[-30, 43], [-14, 43], [2, 43], [18, 43], [-6, 10.1], [12, 10.1]];
    const poles = new THREE.InstancedMesh(poleG, std({ color: 0x3b3c3e, roughness: 0.5, metalness: 0.6 }), poleSpots.length);
    poleSpots.forEach(([x, z], i) => poles.setMatrixAt(i, P(x, G, z, i < 4 ? (i % 2 ? Math.PI : 0) : Math.PI / 2)));
    scene.add(poles); kit.outdoor.push(poles.material);
    // another wing of the school across the lot: two storeys of brick with ribbon windows
    const wing = { x0: -46, x1: 8, z: 56, d: 16, h: 8.2 };
    const wingParts = [box(wing.x1 - wing.x0, wing.h, wing.d, (wing.x0 + wing.x1) / 2, G + wing.h / 2, wing.z + wing.d / 2)];
    const wingGlass = [], wingTrim = [box(wing.x1 - wing.x0 + 0.5, 0.35, wing.d + 0.5, (wing.x0 + wing.x1) / 2, G + wing.h + 0.17, wing.z + wing.d / 2, { uv: false }),
      box(3.5, 1.4, 2.4, -30, G + wing.h + 1.0, wing.z + 6, { uv: false }), box(2.4, 1.0, 2.0, -12, G + wing.h + 0.8, wing.z + 9, { uv: false })];
    for (const fy of [1.1, 4.6]) for (let x = wing.x0 + 2; x < wing.x1 - 2; x += 3.4) {
      wingGlass.push(new THREE.PlaneGeometry(2.6, 1.9).rotateY(Math.PI).translate(x, G + fy + 0.95, wing.z - 0.02));
      wingTrim.push(box(2.8, 0.12, 0.2, x, G + fy - 0.04, wing.z - 0.06, { uv: false }), box(0.1, 1.9, 0.08, x, G + fy + 0.95, wing.z - 0.03, { uv: false }));
    }
    wingTrim.push(box(2.2, 2.6, 0.2, -18, G + 1.3, wing.z - 0.08, { uv: false }));
    put(M.brick, ...wingParts);
    put(M.coping, ...wingTrim);
    const wGlassMat = std({ color: 0x2a3138, roughness: 0.08, metalness: 0.7 });
    put(wGlassMat, ...wingGlass); kit.outdoor.push(wGlassMat);
    // houses beyond the field on the right, sided, with gable roofs
    const sc = cnv(256, 256), sg = sc.getContext("2d");
    sg.fillStyle = "#f2f0ea"; sg.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) { const gr = sg.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, "rgba(0,0,0,0.18)"); gr.addColorStop(0.25, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(255,255,255,0.12)"); sg.fillStyle = gr; sg.fillRect(0, y, 256, 16); }
    const sidingMat = std({ map: ctex(sc, { tile: [1.2, 1.2] }), roughness: 0.6 });
    const houseG = merge([box(9, 5.6, 8, 0, 2.8, 0), ...[-2.6, 0, 2.6].map((x) => tint(box(1.1, 1.4, 0.05, x, 3.9, -4.01, { uv: false }), 0x2c3238)), ...[-2.6, 2.6].map((x) => tint(box(1.1, 1.4, 0.05, x, 1.4, -4.01, { uv: false }), 0x2c3238)), tint(box(1.0, 2.1, 0.05, 0, 1.05, -4.01, { uv: false }), 0x5a3a2a)]);
    const roofShape = new THREE.Shape(); roofShape.moveTo(-5.0, 0); roofShape.lineTo(5.0, 0); roofShape.lineTo(0, 3.1); roofShape.closePath();
    const roofG = new THREE.ExtrudeGeometry(roofShape, { depth: 8.8, bevelEnabled: false }).translate(0, 5.55, -4.4);
    const houseSpots = [[22, 92, 0.12], [36, 96, -0.08], [51, 90, 0.2], [-58, 98, 0.05], [-72, 94, -0.15]];
    const houses = new THREE.InstancedMesh(houseG, std({ map: sidingMat.map, roughness: 0.6, vertexColors: true }), houseSpots.length);
    const roofs = new THREE.InstancedMesh(roofG, std({ color: 0x3e3d3f, roughness: 0.9 }), houseSpots.length);
    const sideCols = [0xf4f1e8, 0xc9d3dc, 0xe8dcc0, 0xb9c4b0, 0xf0e6d8];
    houseSpots.forEach(([x, z, ry], i) => { const m = P(x, G, z, ry); houses.setMatrixAt(i, m); roofs.setMatrixAt(i, m); houses.setColorAt(i, new THREE.Color(sideCols[i])); });
    scene.add(houses, roofs); kit.outdoor.push(houses.material, roofs.material);
    // understory along the tree line so the trees don't stand on a ruled edge
    const under = canopy(17, 22, 1.5, 0.9, 1.2, 0.8, 1.3);
    const uSpots = []; for (let i = 0; i < 90; i++) uSpots.push([(r() - 0.5) * 420, 100 + r() * 30]);
    const underM = new THREE.InstancedMesh(under, shrubMat, uSpots.length);
    uSpots.forEach(([x, z], i) => { underM.setMatrixAt(i, P(x, G, z, r() * 6.28, 1.4 + r() * 1.6)); underM.setColorAt(i, new THREE.Color(0xc8dcb8).multiplyScalar(0.7 + r() * 0.3)); });
    underM.userData.noAO = true; excludeFromOverride(underM); scene.add(underM);
  }

  flush(noCast);
  function flushLate() { flush(noCast); }

  // ---------------- lights
  const sun = new THREE.DirectionalLight(0xfff1de, 3);
  sun.target.position.set(0, 1.6, -0.5);
  scene.add(sun, sun.target);
  // The sun's shadow map is off: on Apple GPUs it made close-ups 6-8x slower (the device chapter fell to
  // 8-20 fps on an M4 at 2x) whatever the filter, size or receivers. The analytic window mask (roomSunMask)
  // still cuts the sunlight into window-shaped patches. ?sunshadow brings it back for comparison.
  const SUN_SHADOW = !low && new URLSearchParams(location.search).has("sunshadow");
  if (SUN_SHADOW) {
    sun.castShadow = true;
    const sz = high ? 4096 : 2048; sun.shadow.mapSize.set(sz, sz);
    sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.012;
  }
  // points the shadow camera must contain: the window apertures (+ sill, lintel, gutter around them)
  const fitPts = [];
  for (const w of WINDOWS) for (const z of [0.5, -0.15]) for (const [x, y] of [[w.x - 0.95, SILL - 0.45], [w.x + 0.95, SILL - 0.45], [w.x - 0.95, R.eave + 0.4], [w.x + 0.95, R.eave + 0.4]]) fitPts.push(V3(x, y, z));
  const roomCorners = [];
  for (const x of [R.x0, R.x1]) for (const y of [FL, R.eave + 0.4]) for (const z of [R.z0, 1.0]) roomCorners.push(V3(x, y, z));
  const shCam = new THREE.Object3D(), inv = new THREE.Matrix4(), tmp = V3();
  function fitShadow() {
    const c = sun.shadow.camera;
    shCam.position.copy(sun.position); shCam.lookAt(sun.target.position); shCam.updateMatrixWorld(); // Object3D.lookAt points +z at the target
    inv.copy(shCam.matrixWorld).invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of fitPts) { tmp.copy(p).applyMatrix4(inv); x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y); }
    for (const p of roomCorners) { tmp.copy(p).applyMatrix4(inv); z0 = Math.min(z0, tmp.z); z1 = Math.max(z1, tmp.z); }
    // the camera looks down its −z, while shCam's +z points at the target: mirror x
    c.left = -x1 - 0.1; c.right = -x0 + 0.1; c.bottom = y0 - 0.1; c.top = y1 + 0.1;
    c.near = Math.max(0.1, z0 - 0.5); c.far = z1 + 0.5;
    c.updateProjectionMatrix();
  }

  const lights = { troffers: [], windows: [], points: [] };
  if (!low) {
    const lvl = high ? 5.5 : 5.5 * 3 / 3;
    // (the 3x3 troffer grid is 3 merged strips on every tier: each area light costs every pixel in view)
    if (false) for (const [x, z] of TROFFERS) { const l = new THREE.RectAreaLight(0xfff6ea, lvl, 0.56, 1.17); l.position.set(x, CEIL - 0.01, z); l.lookAt(x, FL, z); scene.add(l); lights.troffers.push(l); }
    else for (const x of [-2.4384, 0, 2.4384]) { const l = new THREE.RectAreaLight(0xfff6ea, lvl, 0.56, 1.17 * 3 * 0.85); l.position.set(x, CEIL - 0.01, GZ(7)); l.intensity = lvl * 0.58; l.height = GZ(3) - GZ(11) + 1.17; l.lookAt(x, FL, GZ(7)); scene.add(l); lights.troffers.push(l); }
    for (const w of WINDOWS) { const l = new THREE.RectAreaLight(0xdfe9ff, 0, W - 0.16, HEAD - SILL - 0.14); l.position.set(w.x, (SILL + HEAD) / 2, -0.16); l.lookAt(w.x, (SILL + HEAD) / 2, -5); scene.add(l); lights.windows.push(l); }
  } else {
    for (const x of [-2.4, 0, 2.4]) { const l = new THREE.PointLight(0xfff4e6, 3.2, 9, 1.6); l.position.set(x, CEIL - 0.4, -4.6); scene.add(l); lights.points.push(l); }
  }
  const fill = new THREE.HemisphereLight(0xe6ecf5, 0xb3aea4, low ? 0.9 : 0.35); scene.add(fill);
  const bounce = new THREE.PointLight(0xffd9b0, 0, 5.5, 1.6); if (!low) scene.add(bounce);

  // environment: the school-hall HDRI for interior reflections; a PMREM of the live sky for outdoor materials
  const pmrem = new THREE.PMREMGenerator(renderer);
  new RGBELoader(kit.manager).load("assets/hdri/school_hall_1k.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(hdr).texture; hdr.dispose();
    scene.environment = env; scene.environmentRotation.set(0, 1.2, 0);
  });

  // ---------------- volumetric sunbeams through the three windows + dust in the hero beam
  const beamDefines = { STEPS: high ? 24 : mid ? 20 : 14 }; // (40 on high cost ~30 ms a frame at 2x)
  if (SUN_SHADOW) beamDefines.USE_SHADOW = 1;
  const beamU = {
    uSunL: kit.sunU.uSunL, uWins: kit.sunU.uWins, uColor: { value: new THREE.Color(1, 0.93, 0.8) }, uDensity: { value: 0.0 }, uTime: { value: 0 },
    uShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uInv: { value: new THREE.Matrix4() },
  };
  const beamMat = new THREE.ShaderMaterial({
    defines: beamDefines, uniforms: beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      #include <packing>
      ${APERTURE_GLSL}
      uniform vec3 uColor; uniform float uDensity, uTime, uInside; uniform sampler2D uShadow; uniform mat4 uShadowM, uInv;
      varying vec3 vW;
      float h1(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h1(i), h1(i + vec3(1,0,0)), f.x), mix(h1(i + vec3(0,1,0)), h1(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h1(i + vec3(0,0,1)), h1(i + vec3(1,0,1)), f.x), mix(h1(i + vec3(0,1,1)), h1(i + vec3(1,1,1)), f.x), f.y), f.z); }
      vec2 slab(vec3 ro, vec3 rd, vec3 a, vec3 b){ vec3 iv = 1.0 / rd, t0 = (a - ro) * iv, t1 = (b - ro) * iv, mn = min(t0, t1), mx = max(t0, t1);
        return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z)); }
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vW - ro);
        vec2 tb = slab((uInv * vec4(ro, 1.0)).xyz, (uInv * vec4(rd, 0.0)).xyz, vec3(0.0), vec3(1.0));
        vec2 tr = slab(ro, rd, vec3(${R.x0.toFixed(2)}, ${FL.toFixed(2)}, ${R.z0.toFixed(2)}), vec3(${R.x1.toFixed(2)}, ${CEIL.toFixed(2)}, -0.15));
        float t0 = max(max(tb.x, tr.x), 0.0), t1 = min(tb.y, tr.y);
        if (t1 <= t0) discard;
        // standing inside the beam (the device close-up by the window) every pixel marches it: a third of the
        // steps and one noise octave there; the haze reads the same, at a fraction of the cost
        int steps = uInside > 0.5 ? STEPS / 3 : STEPS;
        float dt = (t1 - t0) / float(steps), j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime * 7.0) * 43758.5453);
        float acc = 0.0;
        for (int i = 0; i < STEPS; i++) {
          if (i >= steps) break;
          vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
          float m = roomAperture(p, 0.15) * roomAperture(p, -0.15);
          #ifdef USE_SHADOW
          vec4 sc = uShadowM * vec4(p, 1.0);
          if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) m *= step(sc.z - 0.0015, unpackRGBAToDepth(texture2D(uShadow, sc.xy)));
          #endif
          float n = n3(p * vec3(2.1, 1.4, 2.1) + vec3(uTime * 0.05, uTime * 0.03, -uTime * 0.04)) * 0.7;
          n += uInside > 0.5 ? 0.15 : n3(p * 6.3 - vec3(0.0, uTime * 0.07, 0.0)) * 0.3; // the fine octave's mean, inside
          float tt = t0 + (float(i) + j) * dt;
          acc += m * (0.12 + 1.8 * n * n) * smoothstep(0.25, 1.3, tt) * exp(min(p.z, 0.0) * 0.14);
        }
        float g = 0.6, mu = dot(rd, uSunL), hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
        gl_FragColor = vec4(uColor * (uDensity * acc * dt * (0.25 + 0.075 * hg)), 1.0);
      }`,
  });
  const beams = WINDOWS.filter((w) => w.main).map((w) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5), beamMat.clone());
    m.material.uniforms = { ...beamU, uInv: { value: new THREE.Matrix4() }, uInside: { value: 0 } };
    m.matrixAutoUpdate = false; m.frustumCulled = false; m.renderOrder = 5; excludeFromOverride(m); scene.add(m);
    return { m, w };
  });
  // dust motes
  const DN = high ? 1600 : mid ? 800 : 300, seeds = new Float32Array(DN * 4), dr = rng(8);
  for (let i = 0; i < DN * 4; i++) seeds[i] = dr();
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DN * 3), 3));
  dGeo.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
  const dustU = { uSunL: kit.sunU.uSunL, uWins: kit.sunU.uWins, uTime: { value: 0 }, uScale: { value: 800 }, uColor: { value: new THREE.Color(1, 0.95, 0.85) }, uShadow: beamU.uShadow, uShadowM: beamU.uShadowM, uMin: { value: V3(-1.9, FL + 0.05, -3.6) }, uSize: { value: V3(4.4, CEIL - FL - 0.15, 3.42) } };
  const dust = new THREE.Points(dGeo, new THREE.ShaderMaterial({
    defines: SUN_SHADOW ? { USE_SHADOW: 1 } : {}, uniforms: dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <packing>
      ${APERTURE_GLSL}
      attribute vec4 seed; uniform float uTime, uScale; uniform vec3 uMin, uSize; uniform sampler2D uShadow; uniform mat4 uShadowM;
      varying float vA;
      void main(){
        vec3 drift = vec3(sin(uTime * 0.07 + seed.w * 40.0) * 0.12, uTime * 0.004 * (0.4 + seed.w) - 0.002 * uTime, cos(uTime * 0.05 + seed.w * 31.0) * 0.12);
        vec3 q = fract(seed.xyz + drift / uSize);
        vec3 p = uMin + q * uSize + vec3(sin(uTime * 0.6 + seed.w * 90.0), sin(uTime * 0.45 + seed.w * 70.0), cos(uTime * 0.5 + seed.w * 50.0)) * 0.008;
        float m = roomAperture(p, 0.15) * roomAperture(p, -0.15);
        #ifdef USE_SHADOW
        vec4 sc = uShadowM * vec4(p, 1.0);
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) m *= step(sc.z - 0.0015, unpackRGBAToDepth(texture2D(uShadow, sc.xy)));
        #endif
        vA = m * (0.35 + 0.65 * fract(seed.w * 13.7)) * (0.6 + 0.4 * sin(uTime * (1.0 + seed.y) + seed.x * 30.0));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uScale * (0.0022 + 0.0018 * seed.z) / -mv.z, 1.0, 18.0);
        gl_Position = m < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25) discard; gl_FragColor = vec4(uColor * vA * exp(-r * 16.0), 1.0); }`,
  }));
  dust.frustumCulled = false; dust.renderOrder = 6; scene.add(dust);

  // ---------------- per-frame
  const sunL = V3(), tmpV = V3(), devPos = V3(0.1, SILL + 0.03, -0.3), focus = devPos.clone();
  let skyEnvT = 0;
  function update({ T, dt, time, sunV, sunIntensity, sunColor, day, smoke, live }) {
    sunL.copy(sunV).normalize();
    kit.sunU.uSunL.value.copy(sunL);
    sun.position.copy(sun.target.position).addScaledVector(sunL, 18);
    sun.intensity = sunIntensity; sun.color.copy(sunColor);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    if (sun.castShadow) {
      fitShadow(); sun.shadow.updateMatrices(sun);
      beamU.uShadow.value = sun.shadow.map ? sun.shadow.map.texture : null;
      beamU.uShadowM.value.copy(sun.shadow.matrix);
    }
    // beams: a box from each window opening along the light direction into the room
    const into = tmpV.copy(sunL).multiplyScalar(-1 / Math.max(0.05, sunL.z)); // per metre of depth (z)
    const beamOn = sunL.z > 0.03 && sunL.y > 0;
    for (const { m, w } of beams) {
      m.visible = beamOn;
      const ax = V3(W, 0, 0), ay = V3(0, HEAD - SILL, 0), dz = into.clone().multiplyScalar(9.5);
      m.matrix.makeBasis(ax, ay, dz).setPosition(w.x - W / 2, SILL, 0.15);
      m.matrixWorld.copy(m.matrix);
      m.material.uniforms.uInv.value.copy(m.matrix).invert();
      // inside the box: render the back faces without a depth test
      const c = tmpV.copy(camera.position).applyMatrix4(m.material.uniforms.uInv.value);
      const inside = c.x > -0.02 && c.x < 1.02 && c.y > -0.02 && c.y < 1.02 && c.z > -0.02 && c.z < 1.02;
      m.material.side = inside ? THREE.BackSide : THREE.FrontSide; m.material.depthTest = !inside;
      m.material.uniforms.uInside.value = inside ? 1 : 0;
    }
    beamU.uTime.value = time; dustU.uTime.value = time;
    beamU.uColor.value.copy(sunColor);
    beamU.uDensity.value = beamOn ? 0.022 * sunIntensity * (1 + smoke * 1.2) : 0;
    dustU.uColor.value.copy(sunColor).multiplyScalar(0.55 * sunIntensity);
    dustU.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    dust.visible = beamOn && T > 5.45;

    // window skylight and a warm bounce off the sun patch
    const skyLum = (0.4 + 0.6 * day) * (1 - smoke * 0.35);
    lights.windows.forEach((l) => { l.intensity = 2.2 * skyLum; l.color.setRGB(lerp(0.82, 1.0, smoke), lerp(0.88, 0.78, smoke), lerp(1.0, 0.6, smoke)); });
    fill.intensity = (low ? 0.6 : 0.22) + (low ? 0.4 : 0.18) * day;
    if (!low) {
      const t = (FL + 0.76 - (SILL + HEAD) / 2) / -Math.max(0.1, sunL.y); // where the main beam lands at desk height
      bounce.position.set(-sunL.x * t, FL + 0.5, Math.min(-0.6, -sunL.z * t));
      bounce.intensity = beamOn ? 0.18 * sunIntensity * day : 0;
    }
    if (dynamic.lampBulb) dynamic.lampBulb.emissiveIntensity = (1 - day) * 2.5;

    // the clock shows the real local time
    if (clockHands.h) {
      const d = new Date(), s = d.getSeconds() + d.getMilliseconds() / 1000, tick = Math.floor(s) + Math.min(1, (s % 1) * 6) ** 0.5;
      clockHands.s.rotation.z = -tick / 60 * Math.PI * 2;
      clockHands.m.rotation.z = -(d.getMinutes() + s / 60) / 60 * Math.PI * 2;
      clockHands.h.rotation.z = -((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2;
    }
    if (live && live.aqi != null) setBoard(live.aqi);

    // outdoor materials see the actual sky
    skyEnvT -= dt;
  }

  function godrays(T) {
    if (T < 5.62 || sunL.z < 0.05) return null;
    const pos = camera.position.clone().addScaledVector(sunL, 600);
    return { pos, strength: 0.32 * smooth(range(T, 5.62, 5.8)), threshold: 0.86, tint: 0xffe2bf };
  }
  function dof(T) {
    if (!high) return null;
    const macro = band(T, 5.93, 6.0, 6.95, 7.03);
    if (macro > 0.01) return { focus: camera.position.distanceTo(focus), aperture: 0.0022 * macro, maxblur: 0.008 * macro };
    const verdict = band(T, 7.04, 7.12, 7.95, 8.1);
    if (verdict > 0.01) return { focus: camera.position.distanceTo(devPos), aperture: 0.0006 * verdict, maxblur: 0.004 };
    return null;
  }

  return { update, godrays, dof, sun, setBoard, lights, beams, dust, focus };
}

function mulchTexture() {
  const S = 256, c = cnv(S, S), g = c.getContext("2d"), r = rng(61);
  g.fillStyle = "#3a2a1e"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${90 + r() * 60 | 0},${60 + r() * 35 | 0},${35 + r() * 20 | 0},${0.5 + r() * 0.5})`; g.save(); g.translate(r() * S, r() * S); g.rotate(r() * 6.28); g.fillRect(-4, -1, 5 + r() * 7, 1.5 + r() * 2); g.restore(); }
  return ctex(c, { tile: [0.6, 0.6] });
}
