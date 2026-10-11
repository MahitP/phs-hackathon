// World 1: Earth from orbit.
// - NASA Blue Marble NG (October), Black Marble 2016 city lights, Blue Marble clouds and GEBCO elevation
//   (relief computed in the shader), lit by the real sun, with ray-marched Rayleigh + Mie scattering.
// - The real sky: NASA SVS Deep Star Maps 2020 for the Milky Way and the HYG catalogue for the stars,
//   both turned by Greenwich sidereal time so they sit where they really are tonight.
// - NASA's Suomi NPP (the satellite carrying VIIRS, the camera behind NASA FIRMS fire detections) with
//   physical foil, solar-array and paint materials that reflect the planet through a cube camera.
// - The June 6–8, 2023 smoke plume from CAMS data drifting from Quebec to New Jersey.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Rig } from "../rig.js";
import { latLon, subSolarPoint, range, band, clamp, lerp, glowTexture, canvasTexture } from "../util.js";
import { SURFACE_VS, SURFACE_FS, CLOUD_FS, ATMO_VS, ATMO_FS, SKY_VS, SKY_FS, STAR_VS, STAR_FS } from "../shaders/earth.js";

const PHS = [40.3587, -74.656];
const smoothstep01 = (t) => t * t * (3 - 2 * t);

// Phones: an analytic atmosphere with no loops. Brightness follows the length of the view ray inside a thin
// shell (so the limb glows and the disc gets a light veil at any distance), lit by the sun at that point.
const SIMPLE_ATMO_FS = /* glsl */ `
  uniform vec3 sunDir; varying vec3 vW;
  const float RA = 1.025;
  void main() {
    vec3 ro = cameraPosition, rd = normalize(vW - ro);
    float tc = -dot(ro, rd), d = length(ro + rd * tc);      // closest approach of the ray to the centre
    if (d > RA) discard;
    float half_ = sqrt(max(RA * RA - d * d, 0.0)), ground = d < 1.0 ? sqrt(1.0 - d * d) : 0.0;
    float path = d < 1.0 ? half_ - ground : 2.0 * half_;
    vec3 p = ro + rd * (tc - ground);
    float mu = dot(normalize(p), sunDir);
    float h = clamp((d - 1.0) / (RA - 1.0), 0.0, 1.0);
    float dens = path / 0.45 * (d < 1.0 ? 0.4 : exp(-h * 2.6));
    vec3 col = mix(vec3(1.0, 0.5, 0.25), vec3(0.3, 0.56, 1.0), smoothstep(-0.05, 0.3, mu));
    gl_FragColor = vec4(col * dens * smoothstep(-0.22, 0.3, mu) * 1.3, 1.0);
  }`;
const SIMPLE_ATMO_VS = /* glsl */ `
  varying vec3 vW;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// The 2023 smoke: a continuous layer over the CAMS grid. Density is the model's aerosol optical depth (two
// hours blended), broken into filaments by domain-warped fbm that drifts south-east with the plume.
const SMOKE_VS = /* glsl */ `
  varying vec2 vUv; varying vec3 vN;
  void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SMOKE_FS = /* glsl */ `
  uniform sampler2D uAod; uniform vec2 uSize; uniform vec4 uBox, uPatch; uniform float uMix, uFade, uHour, uTime; uniform vec3 sunDir;
  varying vec2 vUv; varying vec3 vN;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5; mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 ll = uPatch.xy + vUv * uPatch.zw;                          // lon, lat (degrees)
    vec2 g = (ll - uBox.xy) / uBox.zw;                              // 0..1 across the grid's cell centres
    vec2 a = texture2D(uAod, (g * (uSize - 1.0) + 0.5) / uSize).rg * 6.0;
    float aod = mix(a.r, a.g, uMix);
    float edge = smoothstep(-0.07, 0.05, g.x) * smoothstep(1.07, 0.95, g.x) * smoothstep(-0.07, 0.05, g.y) * smoothstep(1.07, 0.95, g.y);
    vec2 p = vec2(ll.x * cos(radians(ll.y)), ll.y) * 0.6;          // roughly equal-area, so the wisps aren't stretched
    vec2 drift = vec2(0.3, -0.2) * uHour + vec2(0.012, -0.008) * uTime;
    vec2 q = vec2(fbm(p + drift), fbm(p + drift + vec2(5.2, 1.3)));
    float n = fbm(p * 1.8 + drift * 1.4 + 2.6 * q);
    float dens = aod * (0.3 + 1.4 * smoothstep(0.28, 0.82, n));
    float alpha = (1.0 - exp(-dens * 0.6)) * edge * uFade;
    if (alpha < 0.004) discard;
    float mu = dot(normalize(vN), sunDir), lit = smoothstep(-0.12, 0.3, mu);
    vec3 col = mix(vec3(0.82, 0.77, 0.68), vec3(0.74, 0.5, 0.28), smoothstep(0.4, 2.5, aod));
    col = mix(col, vec3(0.45, 0.26, 0.13), smoothstep(2.5, 5.0, aod));
    col *= 1.0 - 0.3 * smoothstep(1.0, 4.0, dens);                 // thick smoke shades itself
    col *= mix(vec3(1.0, 0.58, 0.32), vec3(1.0), smoothstep(-0.02, 0.25, mu));  // sunset light on it near the terminator
    gl_FragColor = vec4(col * (0.08 + 1.0 * lit), alpha);
  }`;

/** Greenwich mean sidereal time in radians. */
function gmst(date = new Date()) {
  const jd = date.getTime() / 864e5 + 2440587.5;
  const deg = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360;
  return (deg < 0 ? deg + 360 : deg) * Math.PI / 180;
}

/** Star colour from the B−V index (Ballesteros' temperature formula, then a blackbody approximation). */
function bvToRGB(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)) / 100;
  const r = t <= 66 ? 1 : clamp(1.29293618606 * Math.pow(t - 60, -0.1332047592), 0, 1);
  const g = t <= 66 ? clamp(0.390081578769 * Math.log(t) - 0.631841443788, 0, 1) : clamp(1.12989086089 * Math.pow(t - 60, -0.0755148492), 0, 1);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp(0.543206789110 * Math.log(t - 10) - 1.19625408914, 0, 1);
  return [r, g, b];
}

/** Crinkled-foil normal map for the satellite's MLI blankets. */
function foilNormal() {
  const S = 512, h = new Float32Array(S * S);
  for (let k = 0; k < 340; k++) {               // overlapping creases
    const x0 = Math.random() * S, y0 = Math.random() * S, a = Math.random() * Math.PI, len = 40 + Math.random() * 160, w = 2 + Math.random() * 6, s = (Math.random() - 0.5) * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let t = -len; t < len; t += 1) for (let o = -w; o <= w; o++) {
      const x = Math.round(x0 + dx * t - dy * o) & (S - 1), y = Math.round(y0 + dy * t + dx * o) & (S - 1);
      h[y * S + x] += s * (1 - Math.abs(o) / w) * (1 - Math.abs(t) / len);
    }
  }
  return canvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, nx = h[y * S + ((x + 1) & (S - 1))] - h[y * S + ((x - 1) & (S - 1))], ny = h[((y + 1) & (S - 1)) * S + x] - h[((y - 1) & (S - 1)) * S + x];
      const l = Math.hypot(nx, ny, 1);
      img.data.set([(-nx / l * 0.5 + 0.5) * 255, (-ny / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

export function createEarth({ manager, tier, smoke, renderer }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.004, 400);
  const texLoader = new THREE.TextureLoader(manager), lateLoader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (url, srgb = true, loader = texLoader) => { const t = loader.load(url); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
  const sunDir = new THREE.Vector3(1, 0, 0);
  const seg = tier === "low" ? 96 : 192;
  const hi = tier !== "low";

  // ---- the planet ----
  const surfaceU = {
    dayMap: { value: tex(hi ? "assets/textures/earth/day_4k.jpg" : "vendor/textures/earth_atmos_2048.jpg") },
    nightMap: { value: tex(hi ? "assets/textures/earth/night_4k.jpg" : "vendor/textures/earth_lights_2048.png") },
    specMap: { value: tex("vendor/textures/earth_specular_2048.jpg", false) },
    cloudMap: { value: tex(hi ? "assets/textures/earth/clouds_4k.jpg" : "vendor/textures/earth_clouds_1024.png", hi ? false : true) },
    elevMap: { value: hi ? tex("assets/textures/earth/elevation_4k.jpg", false) : null },
    sunDir: { value: sunDir }, uTexel: { value: new THREE.Vector2(1 / 4096, 1 / 2048) }, uBump: { value: 22 },
    uCloudLuma: { value: hi ? 1 : 0 }, uCloudShift: { value: 0 }, uHasElev: { value: hi ? 1 : 0 },
  };
  const globe = new THREE.Group();
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg * 0.75), new THREE.ShaderMaterial({ uniforms: surfaceU, vertexShader: SURFACE_VS, fragmentShader: SURFACE_FS })));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, seg, seg * 0.75), new THREE.ShaderMaterial({
    uniforms: { cloudMap: surfaceU.cloudMap, sunDir: surfaceU.sunDir, uCloudLuma: surfaceU.uCloudLuma, uCloudShift: surfaceU.uCloudShift },
    vertexShader: SURFACE_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
  }));
  globe.add(clouds);
  const atmoU = { sunDir: { value: sunDir }, uSun: { value: 15 }, uMie: { value: 1 }, uG: { value: 0.76 } };
  const atmo = hi
    ? new THREE.Mesh(new THREE.SphereGeometry(1.025, 128, 96), new THREE.ShaderMaterial({ uniforms: atmoU, vertexShader: ATMO_VS, fragmentShader: ATMO_FS, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }))
    : new THREE.Mesh(new THREE.SphereGeometry(1.026, 96, 72), new THREE.ShaderMaterial({ uniforms: { sunDir: { value: sunDir } }, vertexShader: SIMPLE_ATMO_VS, fragmentShader: SIMPLE_ATMO_FS, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  globe.add(atmo);
  scene.add(globe);

  // sharper maps arrive after the first chapter is already on screen
  /** the 8K maps. Resolves once they're on the GPU: boot runs this behind the loader, because uploading
   *  two 8K textures mid-story froze one frame for ~0.7 s */
  let upgraded = null;
  function upgrade() {
    if (tier !== "high") return Promise.resolve();
    const one = (url, slot) => new Promise((res) => lateLoader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
      renderer.initTexture(t); // upload now, not on the first frame that draws it
      surfaceU[slot].value = t; res();
    }, undefined, () => res()));
    return (upgraded ||= Promise.all([one("assets/textures/earth/day_8k.jpg", "dayMap"), one("assets/textures/earth/night_8k.jpg", "nightMap")]));
  }

  // ---- the real sky ----
  const skyU = { map: { value: null }, uGmst: { value: gmst() }, uExposure: { value: 1.7 } };
  if (hi) {
    const mw = tex("assets/textures/earth/milkyway_glow.jpg");      // soft Milky Way glow; the point stars are the HYG catalogue
    mw.generateMipmaps = false; mw.minFilter = THREE.LinearFilter;   // no mip seam where right ascension wraps
    skyU.map.value = mw;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 64, 32), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }));
    sky.renderOrder = -2; scene.add(sky);
  }
  const stars = new THREE.Group(); scene.add(stars);
  fetch("assets/data/stars.json").then((r) => r.json()).then(({ stars: rows }) => {
    const pos = new Float32Array(rows.length * 3), mag = new Float32Array(rows.length), col = new Float32Array(rows.length * 3), v = new THREE.Vector3();
    rows.forEach(([ra, dec, m, bv], i) => {
      latLon(dec, ra * 15, 170, v); pos.set([v.x, v.y, v.z], i * 3); mag[i] = m; col.set(bvToRGB(bv), i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uScale: { value: Math.min(devicePixelRatio, 2) } }, vertexShader: STAR_VS, fragmentShader: STAR_FS, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    pts.renderOrder = -1; pts.frustumCulled = false; stars.add(pts);
  }).catch(() => {});

  // ---- the sun: HDR disc + lens flare ----
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,250,240,1)", "rgba(255,210,160,0)"), color: new THREE.Color(3, 2.9, 2.7), blending: THREE.AdditiveBlending, depthWrite: false }));
  sunSprite.scale.setScalar(5); scene.add(sunSprite);

  // ---- NASA Suomi NPP ----
  const satPivot = new THREE.Group(), sat = new THREE.Group();
  satPivot.add(sat); scene.add(satPivot);
  const cubeRT = new THREE.WebGLCubeRenderTarget(tier === "high" ? 256 : 128, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.01, 300, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;   // fallback until the cube camera has run
  scene.environmentIntensity = 0.35;
  const crinkle = hi ? foilNormal() : null;
  if (crinkle) { crinkle.wrapS = crinkle.wrapT = THREE.RepeatWrapping; crinkle.repeat.set(2, 2); }
  const gltf = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  gltf.load("assets/models/suomi-npp.glb", (g) => {
    const m = g.scene;
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    m.position.sub(center);
    const env = hi ? cubeRT.texture : null;
    m.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material, map = old.map;
      if (map) map.anisotropy = maxAniso;
      const name = old.name;
      let mat;
      if (name === "foil_gold") mat = new THREE.MeshPhysicalMaterial({ color: 0xc8932c, metalness: 1, roughness: 0.3, normalMap: crinkle, normalScale: new THREE.Vector2(0.6, 0.6), iridescence: hi ? 0.35 : 0, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520], envMap: env, envMapIntensity: 1.5 });
      else if (name === "foil_silver") mat = new THREE.MeshPhysicalMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.26, normalMap: crinkle, normalScale: new THREE.Vector2(0.45, 0.45), envMap: env, envMapIntensity: 1.4 });
      else if (name === "tex_01") mat = new THREE.MeshPhysicalMaterial({ map, metalness: 0.35, roughness: 0.32, clearcoat: hi ? 1 : 0, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1.2 });
      else if (name === "shiny_panel") mat = new THREE.MeshPhysicalMaterial({ map, metalness: 0.6, roughness: 0.2, clearcoat: hi ? 0.8 : 0, envMap: env });
      else mat = new THREE.MeshStandardMaterial({ map, metalness: 0.25, roughness: 0.55, envMap: env, envMapIntensity: 1.0 });
      mat.side = THREE.DoubleSide;
      o.material = mat;
    });
    const holder = new THREE.Group(); holder.add(m);
    holder.scale.setScalar(0.15 / Math.max(size.x, size.y, size.z));
    sat.add(holder);
  });
  const satLight = new THREE.DirectionalLight(0xfff4e6, 3.4); scene.add(satLight, satLight.target);
  const earthshine = new THREE.DirectionalLight(0x8fb4ff, 0.6); scene.add(earthshine, earthshine.target);
  const keyLight = new THREE.DirectionalLight(0xc8d8ff, 0.7); scene.add(keyLight, keyLight.target);
  scene.add(new THREE.AmbientLight(0x8fa6c8, 0.12));

  // the VIIRS swath: a sheet of light from the satellite down to a ~3,000 km wide strip of ground
  const swathGeo = new THREE.BufferGeometry();
  swathGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  // aT: 0 at the satellite, 1 on the ground; aQ = across-track position x aT, so aQ / aT is constant along each
  // line of sight from the instrument. VIIRS is a whiskbroom scanner: one line sweeps across the swath, then the next.
  swathGeo.setAttribute("aT", new THREE.BufferAttribute(new Float32Array([0, 1, 1]), 1));
  swathGeo.setAttribute("aQ", new THREE.BufferAttribute(new Float32Array([0, 0, 1]), 1));
  const swath = new THREE.Mesh(swathGeo, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
    vertexShader: `attribute float aT, aQ; varying float vT, vQ, vR; void main(){ vT = aT; vQ = aQ; vR = length((modelMatrix * vec4(position, 1.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime, uFade; varying float vT, vQ, vR;
      void main(){
        float u = vQ / max(vT, 1e-4);
        float sweep = fract(uTime * 0.55) * 1.2 - 0.1;
        float line = exp(-pow((u - sweep) * 26.0, 2.0)) + 0.35 * exp(-pow((u - sweep + 0.04) * 9.0, 2.0));
        float edge = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
        float body = 0.022 * edge + 0.16 * line * edge;
        float ground = smoothstep(0.0, 0.035, vR - 1.0);   // melt into the haze instead of slicing the planet
        gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * body * smoothstep(0.0, 1.0, vT) * vT * ground * uFade, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  swath.frustumCulled = false;
  scene.add(swath);

  // orbit through the hero point (front-right of the planet), polar, so it sweeps north to south
  const heroPos = new THREE.Vector3(0.55, 0.38, 0.74).normalize().multiplyScalar(1.13);
  const orbitAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), heroPos).normalize();
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _v = new THREE.Vector3(), _side = new THREE.Vector3(), _m = new THREE.Matrix4();

  // ---- the June 2023 smoke plume ----
  let smokeLayer = null, smokeData = null, smokeHours = [-1, -1];
  if (smoke) {
    const { lats, lons } = smoke, nx = lons.length, ny = lats.length;
    const lon0 = lons[0] - 1.5, lon1 = lons[nx - 1] + 1.5, lat0 = lats[0] - 1.5, lat1 = lats[ny - 1] + 1.5, D = Math.PI / 180;
    smokeData = new THREE.DataTexture(new Uint8Array(nx * ny * 4), nx, ny);
    smokeData.magFilter = smokeData.minFilter = THREE.LinearFilter;
    smokeLayer = new THREE.Mesh(
      new THREE.SphereGeometry(1.008, 96, 96, (lon0 + 180) * D, (lon1 - lon0) * D, (90 - lat1) * D, (lat1 - lat0) * D),
      new THREE.ShaderMaterial({
        defines: { OCTAVES: tier === "low" ? 3 : 5 },
        uniforms: {
          uAod: { value: smokeData }, uSize: { value: new THREE.Vector2(nx, ny) },
          uBox: { value: new THREE.Vector4(lons[0], lats[0], lons[nx - 1] - lons[0], lats[ny - 1] - lats[0]) },
          uPatch: { value: new THREE.Vector4(lon0, lat0, lon1 - lon0, lat1 - lat0) },
          uMix: { value: 0 }, uFade: { value: 0 }, uHour: { value: 0 }, uTime: { value: 0 }, sunDir: { value: sunDir },
        },
        vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false,
      }));
    clouds.renderOrder = 1; smokeLayer.renderOrder = 2; atmo.renderOrder = 3;
    smokeLayer.visible = false;
    globe.add(smokeLayer);
  }
  /** upload hours h0 and h1 of the CAMS grid into the R and G channels (only when they change) */
  function smokeHoursTo(h0, h1) {
    if (smokeHours[0] === h0 && smokeHours[1] === h1) return;
    smokeHours = [h0, h1];
    const { aod } = smoke, ny = smoke.lats.length, nx = smoke.lons.length, px = smokeData.image.data, k = smoke.scale / 6 * 255;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (y * nx + x) * 4;
      px[i] = Math.min(255, aod[h0][y][x] * k); px[i + 1] = Math.min(255, aod[h1][y][x] * k);
    }
    smokeData.needsUpdate = true;
  }
  function aodAt(lat, lon, hourF) {
    const { lats, lons, aod } = smoke;
    const fy = clamp((lat - lats[0]) / (lats[1] - lats[0]), 0, lats.length - 1.001), fx = clamp((lon - lons[0]) / (lons[1] - lons[0]), 0, lons.length - 1.001);
    const y0 = Math.floor(fy), x0 = Math.floor(fx), ty = fy - y0, tx = fx - x0;
    const h0 = Math.floor(hourF), h1 = Math.min(aod.length - 1, h0 + 1), th = hourF - h0;
    const at = (h) => { const gr = aod[h];
      return lerp(lerp(gr[y0][x0], gr[y0][x0 + 1], tx), lerp(gr[y0 + 1][x0], gr[y0 + 1][x0 + 1], tx), ty); };
    return lerp(at(h0), at(h1), th) * smoke.scale;
  }

  // ---- labels ----
  function label(html, cls = "") {
    const el = document.createElement("div"); el.className = "lbl " + cls; el.innerHTML = html; el.style.opacity = 0;
    return new CSS2DObject(el);
  }
  const satLabel = label(`<b>Suomi NPP</b><span>824 km up. Its VIIRS camera spots fires; SkyWindow checks its detections every hour.</span>`, "lbl-right");
  satLabel.center.set(0, 0.5);
  satPivot.add(satLabel);
  const quebec = label(`<b>Wildfires in Quebec</b>`, "lbl-dot");
  quebec.position.copy(latLon(50.6, -75.2, 1.02)); globe.add(quebec);
  const njLabel = label(`<b>Princeton</b>`, "lbl-dot");
  njLabel.position.copy(latLon(PHS[0], PHS[1], 1.02)); globe.add(njLabel);

  // ---- camera path (globe sits right of centre while the text is on the left) ----
  const rig = new Rig(camera, [
    { T: 0.0, p: [-0.55, 0.55, 5.9], t: [-1.08, 0.12, 0], fov: 34 },
    { T: 0.3, p: [0.15, 0.62, 3.95], t: [-0.6, 0.28, 0.18], fov: 32 },
    { T: 0.55, p: [0.749, 0.797, 0.872], t: [0.611, 0.422, 0.822], fov: 32 },
    { T: 0.86, p: [0.9, 1.05, 2.25], t: [0.0, 0.42, 0.42], fov: 32 },
    { T: 1.1, p: [0.62, 1.36, 2.8], t: [-0.18, 0.62, 0.63], fov: 32 },
    { T: 1.55, p: [0.78, 1.46, 2.08], t: [-0.2, 0.67, 0.69], fov: 32 },
    { T: 1.95, p: [0.6, 1.2, 1.76], t: [-0.1, 0.64, 0.8], fov: 32 },
    { T: 2.25, p: [0.36, 0.98, 1.38], t: [0.2, 0.647, 0.735], fov: 34 },
    { T: 2.7, p: [0.245, 0.765, 0.865], t: [0.202, 0.647, 0.735], fov: 42 },
  ], { parallax: 0.025 });

  const sunNow = new THREE.Vector3(), sunThen = new THREE.Vector3(), sunEF = new THREE.Vector3(), _n = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  // For the orbit chapter the planet is turned so the satellite's close-up happens over the sunlit side
  // (the lighting stays the real lighting; only the side we look at changes). It turns back for 2023.
  const heroLon = Math.atan2(heroPos.z, -heroPos.x) - Math.PI;
  function spinFor(subLonDeg) { let s = heroLon + 0.7 - subLonDeg * Math.PI / 180; s = ((s + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return s; }
  let hourShown = -1, frame = 0;

  /** Put the camera at a pose {p, t, fov} (the dive into the app drives the camera this way instead of story time). */
  function applyPose(pose) {
    camera.position.fromArray(pose.p); rig.target.fromArray(pose.t); camera.lookAt(rig.target);
    if (Math.abs(camera.fov - pose.fov) > 1e-3) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
  }
  /** where the camera is now, as a pose */
  const pose = () => ({ p: camera.position.toArray(), t: rig.target.toArray(), fov: camera.fov });
  /** the story's camera at story time T, without the pointer parallax */
  const poseAt = (T) => { const o = rig.sample(T); return { p: o.slice(0, 3), t: o.slice(3, 6), fov: o[6] }; };
  /** a point on the surface in world space, with the planet turned as it is right now */
  function surfacePoint(lat, lon) {
    globe.updateMatrixWorld();
    return globe.localToWorld(latLon(lat, lon, 1, new THREE.Vector3())).toArray();
  }

  // `drive` (the dive into the app): { camera: {p, t, fov} } replaces the story's camera path
  function update(T, dt, time, hud, _live, _sound, drive = null) {
    if (drive?.camera) applyPose(drive.camera); else rig.apply(T, dt);
    frame++;
    // sun: the real sun now for the orbit chapter, then the sun of each 2023 hour as the plume plays
    const now = new Date();
    const s0 = subSolarPoint(now); latLon(s0.lat, s0.lon, 1, sunNow);
    const hourF = smoke ? clamp(range(T, 1.12, 1.9) * (smoke.times.length - 1), 0, smoke.times.length - 1) : 0;
    const when = new Date(Date.UTC(2023, 5, 6, 4) + hourF * 3600e3);
    const s1 = subSolarPoint(when); latLon(s1.lat, s1.lon, 1, sunThen);
    const k = range(T, 1.0, 1.15);
    sunEF.copy(sunNow).lerp(sunThen, k).normalize();
    // portrait screens crop the globe to its left half, so turn the lit side further toward the camera there
    const spin = (spinFor(s0.lon) - (camera.aspect < 0.8 ? 0.8 : 0)) * (1 - smoothstep01(range(T, 0.86, 1.12)));
    globe.rotation.y = spin;
    sunDir.copy(sunEF).applyAxisAngle(Y, spin);                    // the sun in world space
    const g = lerp(gmst(now), gmst(when), k);
    skyU.uGmst.value = g - spin; stars.rotation.y = -g + spin;
    sunSprite.position.copy(sunDir).multiplyScalar(90);
    satLight.position.copy(sunDir).multiplyScalar(10);
    surfaceU.uCloudShift.value = time * 0.0006;
    atmoU.uMie.value = 1 + band(T, 1.05, 1.25, 2.3, 2.6) * 1.8;   // hazier limb while the smoke plays

    // satellite: sweeps through the hero point at T = 0.55
    const theta = (T - 0.55) * 1.25 + Math.sin(time * 0.2) * 0.004;
    _q.setFromAxisAngle(orbitAxis, -theta);
    _p.copy(heroPos).applyQuaternion(_q);
    satPivot.position.copy(_p);
    _v.crossVectors(orbitAxis, _p).normalize().negate(); // velocity
    const down = _p.clone().normalize().negate();
    _side.crossVectors(_v, down).normalize();
    _m.makeBasis(_side, down.clone().negate(), _v);
    sat.quaternion.setFromRotationMatrix(_m);
    sat.rotateY(Math.PI * 0.5);
    satPivot.visible = T < 1.35;
    satLabel.position.copy(_side).multiplyScalar(0.13);
    satLabel.element.style.opacity = band(T, 0.42, 0.5, 0.7, 0.8);
    // earthshine: the sunlit planet below lights the satellite from underneath
    _n.copy(_p).normalize();
    earthshine.position.set(0, 0, 0); earthshine.target.position.copy(_p);
    earthshine.intensity = 0.1 + 0.9 * clamp((sunDir.dot(_n) + 0.2) / 0.8);
    keyLight.position.copy(camera.position).sub(satPivot.position).multiplyScalar(4).add(satPivot.position); keyLight.target.position.copy(satPivot.position);
    // reflections of the planet in the foil
    const closeUp = T > 0.3 && T < 0.9, every = closeUp ? (tier === "high" ? 4 : 12) : 40;  // fresh while it fills the frame
    if (hi && satPivot.visible && T < 1.1 && frame % every === 1) {
      sat.visible = false; satLabel.visible = false;
      cubeCam.position.copy(_p); cubeCam.update(renderer, scene);
      sat.visible = true; satLabel.visible = true;
    }

    // VIIRS swath under the satellite
    const sf = band(T, 0.38, 0.5, 0.82, 0.98);
    swath.material.uniforms.uFade.value = sf;
    swath.material.uniforms.uTime.value = time;
    swath.visible = sf > 0.001;
    if (swath.visible) {
      const ground = _p.clone().normalize();
      const a = ground.clone().addScaledVector(_side, 0.24).normalize(), b = ground.clone().addScaledVector(_side, -0.24).normalize();
      swathGeo.attributes.position.array.set([_p.x, _p.y, _p.z, a.x, a.y, a.z, b.x, b.y, b.z]);
      swathGeo.attributes.position.needsUpdate = true;
    }

    // plume
    if (smokeLayer) {
      const f = band(T, 1.0, 1.14, 2.35, 2.55), u = smokeLayer.material.uniforms;
      smokeLayer.visible = f > 0.001;
      if (smokeLayer.visible) {
        const h0 = Math.floor(hourF), h1 = Math.min(smoke.aod.length - 1, h0 + 1);
        smokeHoursTo(h0, h1);
        u.uFade.value = f; u.uMix.value = hourF - h0; u.uHour.value = hourF; u.uTime.value = time;
      }
      const hr = Math.round(hourF);
      if (hr !== hourShown && T > 1.0 && T < 2.6) {
        hourShown = hr;
        const local = new Date(Date.UTC(2023, 5, 6, hr)); // NY local wall-clock rendered from a UTC date
        const day = local.getUTCDate(), h = local.getUTCHours();
        const clock = (h % 12 || 12) + (h < 12 ? " am" : " pm");
        hud.set("plume-time", `June ${day}, 2023, ${clock}`);
        hud.set("plume-aod", aodAt(PHS[0], PHS[1], hourF).toFixed(2));
      }
    }
    quebec.element.style.opacity = band(T, 1.15, 1.3, 1.85, 2.0);
    njLabel.element.style.opacity = band(T, 1.3, 1.45, 2.3, 2.45);
  }

  /** depth of field for the satellite close-up (used by fx.js on the high tier) */
  function dof(T) {
    const w = band(T, 0.44, 0.52, 0.62, 0.72);
    return w > 0.01 ? { focus: camera.position.distanceTo(satPivot.position), aperture: 0.0016 * w, maxblur: 0.008 * w } : null;
  }

  /** light shafts and a lens flare from the sun, faded out when the planet hides it */
  const _c = new THREE.Vector3();
  function godrays() {
    if (!hi) return null;
    const ro = camera.position, b = ro.dot(sunDir), c = ro.lengthSq() - 1.03 * 1.03;
    const closest = Math.sqrt(Math.max(0, ro.lengthSq() - b * b));
    const vis = b > 0 ? 1 : clamp((closest - 1.0) / 0.06);            // 0 behind the Earth, 1 in clear view
    return { pos: _c.copy(sunSprite.position), strength: 0.9, threshold: 1.6, flare: vis * 0.9, tint: 0xffeedd };
  }

  return { scene, camera, update, upgrade, dof, godrays, pose, poseAt, surfacePoint, satellite: sat, exposure: 1.0, bloom: [0.45, 0.5, 0.88] };
}
