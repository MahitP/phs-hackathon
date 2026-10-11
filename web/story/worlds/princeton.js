// World 2: Princeton. Real OpenStreetMap streets and buildings around PHS (baked by
// scripts/bake_story_data.py), wind lines that follow the live wind, and the sunbeam test: a slab of
// haze whose thickness follows aerosol optical depth, with the Beer–Lambert law dimming the beam.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { Rig } from "../rig.js";
import { band, range, clamp, lerp, easeInOut, sunVector, glowTexture } from "../util.js";

const U = 0.1; // 1 unit = 10 m
const VERDICT_HDR = { open: [0.08, 1.0, 0.36], either: [1.05, 0.68, 0.1], shut: [1.1, 0.14, 0.1], ventilate: [0.7, 0.24, 1.1] };
const BEAM_ELEV = 37, BEAM_AZ = 270; // the sun at 5 pm on June 7, 2023

function ribbons(lines, width, y) {
  const pos = [];
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const x0 = l[i] * U, z0 = l[i + 1] * U, x1 = l[i + 2] * U, z1 = l[i + 3] * U;
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1, nx = -dz / len * width / 2, nz = dx / len * width / 2;
      pos.push(x0 + nx, y, z0 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 + nx, y, z1 + nz, x0 - nx, y, z0 - nz, x1 - nx, y, z1 - nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function inside(px, pz, poly) {
  let c = false;
  for (let i = 0, j = poly.length / 2 - 1; i < poly.length / 2; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1], xj = poly[j * 2], zj = poly[j * 2 + 1];
    if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const HAZE_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const HAZE_FS = /* glsl */ `
  uniform vec3 uMin, uMax, uColor, uSun; uniform float uDensity, uTime; varying vec3 vW;
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
  // smoke density: drifting 3-octave noise, thinning toward the top of the layer and fading at its sides
  float dens(vec3 p) {
    float n = noise(p * 0.011 + vec3(uTime * 0.02, 0.0, uTime * 0.01)) * 0.6
            + noise(p * 0.037 - vec3(0.0, uTime * 0.012, uTime * 0.02)) * 0.3
            + noise(p * 0.11 + vec3(uTime * 0.05)) * 0.1;
    float h = (p.y - uMin.y) / (uMax.y - uMin.y);
    float vert = smoothstep(0.0, 0.22, h) * smoothstep(1.0, 0.5, h);
    float edge = smoothstep(0.0, 120.0, min(min(p.x - uMin.x, uMax.x - p.x), min(p.z - uMin.z, uMax.z - p.z)));
    return max(n * 1.7 - 0.35, 0.0) * vert * edge;
  }
  void main() {
    vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
    vec3 t0 = (uMin - ro) / rd, t1 = (uMax - ro) / rd;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0)), tf = min(min(tmax.x, tmax.y), tmax.z);
    float thick = tf - tn;
    if (thick <= 0.0) discard;
    // 8 samples through the slab, offset per pixel by interleaved gradient noise so banding becomes an even, still dither
    float seg = thick / 8.0, j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))), tau = 0.0;
    for (int i = 0; i < 8; i++) tau += dens(ro + rd * (tn + seg * (float(i) + j))) * seg;
    tau *= uDensity;
    // Henyey-Greenstein forward scattering: the smoke glows around the sun
    float mu = dot(rd, uSun), g = 0.72;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.0796;
    float a = 1.0 - exp(-tau);
    gl_FragColor = vec4(uColor * (0.7 + 0.85 * hg), a);
  }`;

const BEAM_VS = `attribute float aS; varying float vS; varying vec3 vN; varying vec3 vW;
  void main(){ vS = aS; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FS = /* glsl */ `
  uniform float uEnter, uExit, uT, uAod, uFade; varying float vS; varying vec3 vN; varying vec3 vW;
  void main() {
    float k = vS < uEnter ? 1.0 : (vS < uExit ? mix(1.0, uT, (vS - uEnter) / (uExit - uEnter)) : uT);
    vec3 warm = mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.42, 0.14), smoothstep(0.25, 1.4, uAod) * smoothstep(uEnter, uExit, vS));
    float edge = pow(abs(dot(normalize(vN), normalize(cameraPosition - vW))), 1.6);
    gl_FragColor = vec4(warm * k * edge * 0.95 * uFade, 1.0);
  }`;

// Facade windows, added to the standard material: a grid of panes on every wall (one per 6 m bay per
// floor), some lit warm or cool. Cells smaller than a couple of pixels fade to their average glow, so
// distant blocks shimmer instead of aliasing.
const WINDOW_GLSL = /* glsl */ `
  varying vec3 vWP; varying vec3 vWN; uniform float uLit;
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec4 facade(bool school) {
    vec3 n = normalize(vWN);
    if (abs(n.y) > 0.4) return vec4(0.0);
    vec2 t = normalize(vec2(-n.z, n.x));
    vec2 q = vec2(dot(vWP.xz, t) / 0.6, (vWP.y - 0.18) / 0.72);   // bays along the wall, floors up it
    if (q.y < 0.0) return vec4(0.0);
    vec2 cell = floor(q), f = fract(q), fw = fwidth(q);
    float fade = 1.0 - smoothstep(0.3, 0.75, max(fw.x, fw.y));
    vec2 e = max(fw, vec2(0.015));
    if (school) {
      // PHS: continuous ribbon windows with slim mullions, all lit
      float band = smoothstep(0.3 - e.y, 0.3 + e.y, f.y) * smoothstep(0.8 + e.y, 0.8 - e.y, f.y);
      float mull = smoothstep(0.02, 0.06 + e.x, min(f.x, 1.0 - f.x));
      float m = mix(0.42, band * mull, fade);
      return vec4(vec3(1.0, 0.84, 0.6) * 1.15 * m, mix(0.4, band, fade));
    }
    float pane = smoothstep(0.2 - e.x, 0.2 + e.x, f.x) * smoothstep(0.8 + e.x, 0.8 - e.x, f.x)
               * smoothstep(0.26 - e.y, 0.26 + e.y, f.y) * smoothstep(0.84 + e.y, 0.84 - e.y, f.y);
    float key = wHash(cell + floor(t * 5.0 + 5.0) * 17.3);
    float lit = step(key, uLit);
    vec3 c = mix(vec3(1.0, 0.7, 0.4), vec3(0.78, 0.88, 1.0), step(0.8, wHash(cell * 1.7 + 3.1))) * (0.45 + 0.9 * wHash(cell + 9.2));
    float m = mix(uLit * 0.3, pane * lit, fade);
    return vec4(c * m * 0.95, mix(0.3, pane, fade));
  }`;

function withWindows(mat, school, litU) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = litU;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP; varying vec3 vWN;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + WINDOW_GLSL)
      .replace("#include <color_fragment>", `#include <color_fragment>\nvec4 win = facade(${school}); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.03, 0.04), win.a * ${school ? "0.9" : "0.75"});`)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += win.rgb;");
  };
  mat.customProgramCacheKey = () => (school ? "phs-windows" : "town-windows");
  return mat;
}

// Aerosol motes in the beam: sparkle as they turn, dimmed by the same Beer–Lambert curve as the beam.
const MOTE_VS = /* glsl */ `
  attribute vec4 aR;  // x: threshold, y: phase, z: fraction along the beam from the sun, w: distance from its axis
  uniform float uTime, uAmount, uFade, uScale, uEnter, uExit, uT;
  varying float vA;
  void main() {
    vec3 p = position + vec3(sin(uTime * 0.31 + aR.y * 40.0), sin(uTime * 0.23 + aR.y * 17.0) * 0.6, cos(uTime * 0.27 + aR.y * 29.0)) * 1.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float k = aR.z < uEnter ? 1.0 : (aR.z < uExit ? mix(1.0, uT, (aR.z - uEnter) / (uExit - uEnter)) : uT);
    float tw = pow(0.5 + 0.5 * sin(uTime * (1.3 + aR.x * 2.7) + aR.y * 60.0), 6.0);
    vA = step(aR.x, uAmount) * uFade * k * exp(-aR.w * aR.w * 0.16) * (0.2 + 1.8 * tw);
    gl_PointSize = max((2.2 + 4.5 * tw) * uScale / -mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const MOTE_FS = /* glsl */ `
  uniform vec3 uColor; varying float vA;
  void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor * smoothstep(0.5, 0.0, r) * vA, 1.0); }`;

export function createPrinceton({ data, tier, renderer }) {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x06080b);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 380, 900);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 4000);

  // ground with a faint 100 m survey grid
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uFog: { value: bg } },
    vertexShader: HAZE_VS,
    fragmentShader: `uniform vec3 uFog; varying vec3 vW;
      void main(){ vec2 g = abs(fract(vW.xz / 10.0 - 0.5) - 0.5) * 10.0; float d = 1.0 - smoothstep(0.18, 0.5, length(g));
        float r = length(vW.xz); vec3 col = vec3(0.022, 0.027, 0.034) + vec3(0.07, 0.09, 0.11) * d * smoothstep(650.0, 60.0, r);
        gl_FragColor = vec4(mix(col, uFog, smoothstep(300.0, 820.0, r)), 1.0); }`,
  }));
  scene.add(ground);

  const sunDir = sunVector(BEAM_ELEV, BEAM_AZ);
  const light = new THREE.DirectionalLight(0xffe7cf, 1.6); light.position.copy(sunDir).multiplyScalar(500); scene.add(light);
  scene.add(new THREE.HemisphereLight(0x8aa0bd, 0x0a0c10, 0.6));
  const shadows = tier !== "low";
  if (shadows) {
    // nothing in this world moves, so the shadow map is drawn once
    light.castShadow = true;
    light.shadow.mapSize.setScalar(tier === "high" ? 4096 : 2048);
    Object.assign(light.shadow.camera, { left: -430, right: 430, top: 430, bottom: -430, near: 50, far: 1100 });
    light.shadow.bias = -0.0004; light.shadow.normalBias = 0.35;
    light.shadow.autoUpdate = false; light.shadow.needsUpdate = true;
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.6, depthWrite: false }));
    catcher.position.y = 0.16; catcher.receiveShadow = true; scene.add(catcher);
  }
  // lit windows follow the local hour: busier at night
  const hour = new Date().getHours();
  const litU = { value: hour >= 19 || hour < 6 ? 0.42 : hour >= 16 ? 0.3 : 0.16 };

  const verdictColor = new THREE.Color(...VERDICT_HDR.either);
  let campus = null;
  if (data) {
    scene.add(new THREE.Mesh(ribbons(data.minor, 0.7, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.25, 0.31), side: THREE.DoubleSide })));
    scene.add(new THREE.Mesh(ribbons(data.major, 1.4, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.46, 0.52, 0.61), side: THREE.DoubleSide })));
    for (const w of data.water) {
      const shape = new THREE.Shape(); for (let i = 0; i < w.length; i += 2) (i ? shape.lineTo : shape.moveTo).call(shape, w[i] * U, -w[i + 1] * U);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b1a2b }));
      m.position.y = 0.03; scene.add(m);
    }
    campus = data.phs[0] ? data.phs[0].map((v) => v * U) : null;
    const town = [], school = [];
    for (const b of data.buildings) {
      const pts = b.p; if (pts.length < 8) continue;
      const shape = new THREE.Shape();
      for (let i = 0; i < pts.length; i += 2) (i ? shape.lineTo : shape.moveTo).call(shape, pts[i] * U, -pts[i + 1] * U);
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.h * U * 2.0, bevelEnabled: false }).rotateX(-Math.PI / 2);
      let cx = 0, cz = 0; for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cz += pts[i + 1]; }
      cx = cx / (pts.length / 2) * U; cz = cz / (pts.length / 2) * U;
      (b.school || (campus && inside(cx, cz, campus)) ? school : town).push(g);
    }
    if (town.length) {
      const g = mergeGeometries(town);
      const m = new THREE.Mesh(g, withWindows(new THREE.MeshStandardMaterial({ color: 0x343d49, roughness: 0.8, metalness: 0.1 }), false, litU));
      m.castShadow = m.receiveShadow = shadows; scene.add(m);
      if (tier !== "low") scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 40), new THREE.LineBasicMaterial({ color: 0x7d90a6, transparent: true, opacity: 0.28, fog: true })));
    }
    if (school.length) {
      const g = mergeGeometries(school);
      const m = new THREE.Mesh(g, withWindows(new THREE.MeshStandardMaterial({ color: 0xf2f3f0, roughness: 0.55, emissive: 0x4a5058 }), true, litU));
      m.castShadow = m.receiveShadow = shadows; scene.add(m);
      scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 40), new THREE.LineBasicMaterial({ color: 0xffffff })));
    }
    if (campus) {
      const ring = campus.concat(campus.slice(0, 2)).map((v, i) => v / U);
      scene.add(new THREE.Mesh(ribbons([ring], 1.1, 0.25), new THREE.MeshBasicMaterial({ color: verdictColor, side: THREE.DoubleSide })));
      const cs = new THREE.Shape(); for (let i = 0; i < campus.length; i += 2) (i ? cs.lineTo : cs.moveTo).call(cs, campus[i], -campus[i + 1]);
      const fillM = new THREE.Mesh(new THREE.ShapeGeometry(cs).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: verdictColor, transparent: true, opacity: 0.07, depthWrite: false }));
      fillM.position.y = 0.12; scene.add(fillM);
    }
  }

  // beacon over PHS + pulse rings
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 220, 16, 1, true).translate(0, 110, 0), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: verdictColor }, uFade: { value: 1 } },
    vertexShader: `varying float vY; void main(){ vY = position.y / 220.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFade; varying float vY; void main(){ gl_FragColor = vec4(uColor * pow(1.0 - vY, 2.6) * 0.55 * uFade, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  scene.add(beacon);
  const rings = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: verdictColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.y = 0.4; scene.add(m); return m;
  });

  // wind lines
  const N = tier === "low" ? 320 : 700, wPos = new Float32Array(N * 6), wCol = new Float32Array(N * 8), parts = [];
  for (let i = 0; i < N; i++) {
    const r = Math.sqrt(Math.random()) * 430, a = Math.random() * Math.PI * 2;
    parts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: 4 + Math.random() * 24, s: 0.7 + Math.random() * 0.6 });
    wCol.set([0.8, 0.88, 1.0, 0.5, 0.8, 0.88, 1.0, 0.0], i * 8);
  }
  const windGeo = new THREE.BufferGeometry();
  windGeo.setAttribute("position", new THREE.BufferAttribute(wPos, 3));
  windGeo.setAttribute("color", new THREE.BufferAttribute(wCol, 4));
  const wind = new THREE.LineSegments(windGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
  wind.frustumCulled = false;
  scene.add(wind);
  const windVec = new THREE.Vector2(1, 0);
  let windSpeed = 10;

  // traffic: headlights and taillights moving along the real major roads, driving on the right
  const cars = [], roads = [];
  if (data && tier !== "low") {
    for (const l of data.major) {
      const pts = l.map((v) => v * U), cum = [0];
      let near = Infinity;
      for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
      for (let i = 0; i < pts.length; i += 2) near = Math.min(near, Math.hypot(pts[i], pts[i + 1]));
      const len = cum[cum.length - 1];
      if (len > 6 && near < 650) roads.push({ pts, cum, len, gap: 7 + Math.random() * 10, v: 1.3 + Math.random() * 1.3 });
    }
    const cap = tier === "high" ? 1600 : 900;
    for (const r of roads) {
      for (let s = Math.random() * r.gap; s < r.len && cars.length < cap; s += r.gap * (0.5 + Math.random())) {
        cars.push({ r, s, dir: Math.random() < 0.5 ? 1 : -1, v: r.v * (0.8 + Math.random() * 0.4), i: 0 });
      }
    }
  }
  const tPos = new Float32Array(Math.max(cars.length, 1) * 3), tCol = new Float32Array(Math.max(cars.length, 1) * 3);
  const trafficGeo = new THREE.BufferGeometry();
  trafficGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
  trafficGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
  const traffic = new THREE.Points(trafficGeo, new THREE.PointsMaterial({
    size: 2.6, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  }));
  traffic.frustumCulled = false; traffic.visible = cars.length > 0;
  scene.add(traffic);
  const HEAD = [2.4, 2.2, 1.8], TAIL = [2.2, 0.1, 0.05];
  function moveTraffic(dt) {
    const cx = camera.position.x, cz = camera.position.z;
    for (let k = 0; k < cars.length; k++) {
      const c = cars[k], r = c.r, cum = r.cum;
      c.s += c.v * dt * c.dir;
      if (c.s > r.len) { c.s -= r.len; c.i = 0; } else if (c.s < 0) { c.s += r.len; c.i = cum.length - 2; }
      while (c.i < cum.length - 2 && c.s > cum[c.i + 1]) c.i++;
      while (c.i > 0 && c.s < cum[c.i]) c.i--;
      const a = c.i * 2, x0 = r.pts[a], z0 = r.pts[a + 1], x1 = r.pts[a + 2], z1 = r.pts[a + 3];
      const segLen = cum[c.i + 1] - cum[c.i] || 1, f = (c.s - cum[c.i]) / segLen;
      const dx = (x1 - x0) / segLen * c.dir, dz = (z1 - z0) / segLen * c.dir;
      const x = x0 + (x1 - x0) * f - dz * 0.32, z = z0 + (z1 - z0) * f + dx * 0.32;  // right-hand lane
      tPos[k * 3] = x; tPos[k * 3 + 1] = 0.35; tPos[k * 3 + 2] = z;
      // coming toward the camera: headlights; going away: taillights
      const col = dx * (cx - x) + dz * (cz - z) > 0 ? HEAD : TAIL;
      tCol[k * 3] = col[0]; tCol[k * 3 + 1] = col[1]; tCol[k * 3 + 2] = col[2];
    }
    trafficGeo.attributes.position.needsUpdate = true; trafficGeo.attributes.color.needsUpdate = true;
  }

  // sunbeam test: haze slab + sun + beam
  const slabMin = new THREE.Vector3(-480, 60, -420), slabMax = new THREE.Vector3(380, 160, 420);
  const haze = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
    uniforms: { uMin: { value: slabMin }, uMax: { value: slabMax }, uColor: { value: new THREE.Color() }, uSun: { value: sunDir }, uDensity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: HAZE_VS, fragmentShader: HAZE_FS, transparent: true, depthWrite: false, side: THREE.BackSide,
  }));
  haze.scale.subVectors(slabMax, slabMin); haze.position.addVectors(slabMin, slabMax).multiplyScalar(0.5);
  scene.add(haze);
  const sunPos = sunDir.clone().multiplyScalar(520);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,240,215,1)", "rgba(255,190,120,0)"), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sunSprite.material.color.setRGB(2.4, 2.15, 1.8); // an HDR core, so bloom and the god-ray pass pick it up
  sunSprite.position.copy(sunPos); sunSprite.scale.setScalar(70); scene.add(sunSprite);
  const beamLen = sunPos.length();
  const beamGeo = new THREE.CylinderGeometry(2.6, 2.6, beamLen, 24, 40, true);
  const sArr = new Float32Array(beamGeo.attributes.position.count);
  for (let i = 0; i < sArr.length; i++) sArr[i] = 0.5 - beamGeo.attributes.position.getY(i) / beamLen; // 0 at the sun end, 1 at PHS
  beamGeo.setAttribute("aS", new THREE.BufferAttribute(sArr, 1));
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    uniforms: { uEnter: { value: 0 }, uExit: { value: 1 }, uT: { value: 1 }, uAod: { value: 0 }, uFade: { value: 0 } },
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  beam.position.copy(sunPos).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
  scene.add(beam);
  // where the beam crosses the slab (fractions along it, measured from the sun)
  const enter = 1 - (slabMax.y / sunPos.y), exit = 1 - (slabMin.y / sunPos.y);
  beam.material.uniforms.uEnter.value = enter; beam.material.uniforms.uExit.value = exit;

  // motes: scattered through the beam from just above the smoke layer down to the school
  const MOTES = tier === "high" ? 2400 : tier === "mid" ? 1300 : 450;
  const mPos = new Float32Array(MOTES * 3), mR = new Float32Array(MOTES * 4);
  const ax = new THREE.Vector3(), side = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(side, sunDir).normalize();
  for (let i = 0; i < MOTES; i++) {
    const s = lerp(enter - 0.08, 1.0, Math.pow(Math.random(), 0.8)), rad = Math.sqrt(Math.random()) * 5.5, ang = Math.random() * Math.PI * 2;
    ax.copy(sunDir).multiplyScalar(beamLen * (1 - s)).addScaledVector(side, Math.cos(ang) * rad).addScaledVector(up, Math.sin(ang) * rad);
    mPos.set([ax.x, ax.y, ax.z], i * 3);
    mR.set([Math.random(), Math.random(), s, rad], i * 4);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(mPos, 3));
  moteGeo.setAttribute("aR", new THREE.BufferAttribute(mR, 4));
  const moteU = {
    uTime: { value: 0 }, uAmount: { value: 0 }, uFade: { value: 0 }, uScale: { value: 450 },
    uEnter: { value: enter }, uExit: { value: exit }, uT: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.85, 0.62) },
  };
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({
    uniforms: moteU, vertexShader: MOTE_VS, fragmentShader: MOTE_FS, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  motes.frustumCulled = false; scene.add(motes);
  const _db = new THREE.Vector2(), raysTint = new THREE.Color(), PHS = new THREE.Vector3(0, 4, 0);
  const tintClear = new THREE.Color(1.0, 0.94, 0.84), tintSmoke = new THREE.Color(1.0, 0.6, 0.3);

  // label
  const el = document.createElement("div"); el.className = "lbl lbl-dot lbl-phs"; el.style.opacity = 0;
  el.innerHTML = `<b>Princeton High School</b><span data-bind="phs-live">Reading the air…</span>`;
  const phsLabel = new CSS2DObject(el); phsLabel.position.set(0, 24, 0); scene.add(phsLabel);

  const rig = new Rig(camera, [
    { T: 2.6, p: [40, 470, 430], t: [0, 0, 0], fov: 40 },
    { T: 3.05, p: [-80, 235, 265], t: [0, 0, 20], fov: 38 },
    { T: 3.5, p: [-150, 105, 175], t: [-44, 10, -37], fov: 34 },
    { T: 3.95, p: [120, 95, 230], t: [-50, 10, 37], fov: 34 },
    { T: 4.15, p: [-180, 150, 720], t: [-230, 170, 0], fov: 38 },
    { T: 4.6, p: [-150, 140, 650], t: [-215, 160, 0], fov: 38 },
    { T: 4.88, p: [30, 70, 110], t: [0, 4, 0], fov: 40 },
    { T: 5.2, p: [4, 16, 18], t: [0, 3, 0], fov: 46 },
  ], { parallax: 0.02 });

  let aodToday = 0.18, liveSeen = null, aodNow = 0.18;
  const hazeClear = new THREE.Color(0.8, 0.85, 0.9), hazeSmoke = new THREE.Color(0.72, 0.42, 0.2);
  const sinEl = Math.sin(BEAM_ELEV * Math.PI / 180);

  function setLive(live) {
    if (!live || live === liveSeen) return;
    liveSeen = live;
    if (live.aod != null) aodToday = live.aod;
    verdictColor.setRGB(...(VERDICT_HDR[live.verdict] || VERDICT_HDR.either));
    if (live.windDir != null) {
      const az = (live.windDir + 180) * Math.PI / 180; // wind_dir is where it comes FROM
      windVec.set(Math.sin(az), -Math.cos(az));
    }
    if (live.wind != null) windSpeed = live.wind;
  }

  function update(T, dt, time, hud, live) {
    setLive(live);
    rig.apply(T, dt);
    const pulse = (time * 0.35) % 1;
    rings.forEach((r, i) => { const p = (pulse + i / 3) % 1; r.scale.setScalar(4 + p * 70); r.material.opacity = (1 - p) * 0.32; });
    beacon.material.uniforms.uFade.value = 1 - range(T, 4.0, 4.2) * 0.9;

    // wind
    const sp = (6 + windSpeed * 1.1) * dt, tail = 3 + windSpeed * 0.5;
    for (let i = 0; i < N; i++) {
      const p = parts[i];
      p.x += windVec.x * sp * p.s; p.z += windVec.y * sp * p.s;
      if (p.x * p.x + p.z * p.z > 430 * 430) { const a = Math.random() * Math.PI * 2, r = 420; p.x = -windVec.x * r + Math.cos(a) * 200; p.z = -windVec.y * r + Math.sin(a) * 200; }
      wPos.set([p.x, p.y, p.z, p.x - windVec.x * tail * p.s, p.y, p.z - windVec.y * tail * p.s], i * 6);
    }
    windGeo.attributes.position.needsUpdate = true;
    wind.material.opacity = 1 - range(T, 4.0, 4.2) * 0.75;
    if (cars.length) { moveTraffic(Math.min(dt, 0.1)); traffic.material.opacity = 1 - range(T, 4.0, 4.2) * 0.6; }

    // sunbeam test (chapter index 4)
    const f = band(T, 4.0, 4.14, 4.9, 5.0);
    const aod = lerp(aodToday, 1.44, easeInOut(range(T, 4.22, 4.74)));
    const tr = Math.exp(-aod / sinEl);
    haze.visible = beam.visible = sunSprite.visible = f > 0.001;
    haze.material.uniforms.uDensity.value = aod * 0.0011 * f;
    haze.material.uniforms.uColor.value.copy(hazeClear).lerp(hazeSmoke, range(aod, 0.3, 1.3));
    haze.material.uniforms.uTime.value = time;
    beam.material.uniforms.uT.value = tr;
    beam.material.uniforms.uAod.value = aod;
    beam.material.uniforms.uFade.value = f;
    sunSprite.material.opacity = f * 0.85;
    aodNow = aod;
    motes.visible = f > 0.001;
    moteU.uTime.value = time; moteU.uFade.value = f; moteU.uT.value = tr;
    moteU.uAmount.value = 0.25 + 0.75 * range(aod, 0.15, 1.3);
    moteU.uColor.value.copy(tintClear).lerp(tintSmoke, range(aod, 0.3, 1.3));
    moteU.uScale.value = renderer ? renderer.getDrawingBufferSize(_db).y * 0.5 : 450;
    if (f > 0.001) { hud.set("beam-aod", aod.toFixed(2)); hud.set("beam-t", Math.round(tr * 100) + "%"); }

    el.style.opacity = band(T, 3.25, 3.4, 3.98, 4.08);
  }

  return {
    scene, camera, update, exposure: 1.0, bloom: [0.85, 0.5, 0.8], aodToday: () => aodToday,
    // contact shadows between buildings, roads and ground; off while the haze slab is up (it is a mesh the AO pass would see)
    ao: { radius: 3, distanceExponent: 1, thickness: 3, scale: 1, samples: 16 },
    aoOn: (T) => T < 4.0 || T > 4.98,
    /** screen-space shafts from the sun during the sunbeam test; stronger and warmer as the smoke thickens */
    godrays(T) {
      const f = band(T, 4.0, 4.14, 4.9, 5.0);
      if (f < 0.01) return null;
      const k = range(aodNow, 0.2, 1.4);
      return { pos: sunPos, strength: f * (0.55 + 0.7 * k), threshold: 0.95, tint: raysTint.copy(tintClear).lerp(tintSmoke, k), flare: f * 0.45 };
    },
    /** a shallow, tilt-shift focus on PHS in the street-level beat */
    dof(T) {
      const f = band(T, 3.3, 3.45, 3.85, 3.95);
      if (f < 0.01) return null;
      return { focus: camera.position.distanceTo(PHS), aperture: 0.000022 * f, maxblur: 0.006 };
    },
  };
}
