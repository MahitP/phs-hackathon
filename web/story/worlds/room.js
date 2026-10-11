// World 3: the classroom window. We fly in from outside, through the opening under the sash, turn
// around and find the device on the sill. Its parts come apart, then the window acts out the four
// verdicts against four skies. The sky is three.js's physically based Sky with sun position and haze;
// the room around it (models/classroom.js) is a furnished high-school science classroom.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { Rig } from "../rig.js";
import { createSashWindow } from "../models/sash.js";
import { createKit, createClassroom } from "../models/classroom.js";
import { createDevice } from "../models/device.js";
import { band, range, clamp, lerp, easeInOut, smooth, sunVector, glowTexture } from "../util.js";
import { LCD } from "../../shell/copy.js";

// skies for each verdict scene: [turbidity, rayleigh, mie, smoke 0..1, sun elevation, sun azimuth, raise]
const SKY = {
  intro: [2.6, 2.2, 0.005, 0, 30, 228, null],
  open: [2.0, 2.3, 0.003, 0, 42, 175, 0.34],
  either: [7.5, 1.0, 0.012, 0, 14, 245, 0.08],
  shut: [14, 0.35, 0.05, 1, 37, 270, 0],
  ventilate: [2.2, 2.2, 0.004, 0, 42, 175, 0.64],
};
// chapter index 7 ("the verdict") is split into these beats (local progress)
export const VERDICT_BEATS = [["open", 0.04, 0.25], ["either", 0.27, 0.48], ["shut", 0.5, 0.71], ["ventilate", 0.73, 0.99]];

export function createRoom({ renderer, tier, manager }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.03, 9000);
  scene.environmentIntensity = 0.35;
  scene.fog = new THREE.Fog(0xb9c6d4, 35, 950); // aerial perspective outside; nothing in the room is that far

  // sky + an orange smoke veil for June 2023
  const sky = new Sky(); sky.scale.setScalar(4500); scene.add(sky);
  const su = sky.material.uniforms; su.mieDirectionalG.value = 0.82;
  const veil = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.ShaderMaterial({
    uniforms: { uAmt: { value: 0 } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uAmt; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(vec3(1.0, 0.56, 0.2), vec3(0.6, 0.3, 0.12), pow(h, 0.55));
        gl_FragColor = vec4(c, uAmt * (0.88 - 0.22 * h)); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false,
  }));
  scene.add(veil);

  // a small copy of the sky for image-based light on the facade, lawn, trees and glass
  const skyEnvScene = new THREE.Scene();
  // (without the sun's disc: its energy would light everything a second time, with no shadows)
  const skyEnvMat = sky.material.clone(); skyEnvMat.uniforms = su;
  skyEnvMat.fragmentShader = skyEnvMat.fragmentShader.replace("L0 += ( vSunE * 19000.0 * Fex ) * sundisk;", "");
  const skyEnvMesh = new THREE.Mesh(sky.geometry, skyEnvMat); skyEnvMesh.scale.setScalar(400); skyEnvScene.add(skyEnvMesh);
  const veilEnvMesh = new THREE.Mesh(veil.geometry, veil.material); veilEnvMesh.scale.setScalar(0.09); skyEnvScene.add(veilEnvMesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let skyEnv = null, skyEnvKey = "";

  // the window wall, the classroom, the device on the sill
  const kit = createKit({ renderer, tier, manager });
  const win = createSashWindow({ tier, kit }); scene.add(win.root);
  const room = createClassroom({ scene, renderer, tier, kit, win, camera });
  const device = createDevice({ tier });
  device.root.position.set(0.1, win.sillTop, -0.3);
  scene.add(device.root);

  // ventilate: VOC haze leaving through the gap; voice: rings out of the speaker
  const VN = 260, vPos = new Float32Array(VN * 3), vSeed = new Float32Array(VN);
  for (let i = 0; i < VN; i++) vSeed[i] = Math.random();
  const vGeo = new THREE.BufferGeometry(); vGeo.setAttribute("position", new THREE.BufferAttribute(vPos, 3));
  const voc = new THREE.Points(vGeo, new THREE.PointsMaterial({ map: glowTexture("rgba(190,120,255,1)", "rgba(150,80,220,0)"), size: 0.05, transparent: true, depthWrite: false, opacity: 0 }));
  voc.frustumCulled = false; scene.add(voc);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const rings = [0, 1, 2].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), ringMat.clone()); r.visible = false; kit.excludeFromOverride(r); scene.add(r); return r; });

  // labels for the exploded view
  function label(html, cls) { const el = document.createElement("div"); el.className = "lbl lbl-light " + cls; el.innerHTML = html; el.style.opacity = 0; return new CSS2DObject(el); }
  const labels = {
    air: label(`<b>Air sensor</b><span>Grove gas sensor, port A0</span>`, "lbl-right"),
    light: label(`<b>Light sensor</b><span>Faces the sky, port A2</span>`, "lbl-right"),
    pi: label(`<b>Raspberry Pi 4 + Grove HAT</b><span>Decides once a second</span>`, "lbl-right"),
    lcd: label(`<b>16×2 RGB screen</b><span>I2C</span>`, "lbl-right"),
    speaker: label(`<b>Speaker</b><span>Reads the update aloud</span>`, "lbl-right"),
  };
  device.parts.air.add(labels.air); labels.air.position.set(0.024, 0.016, 0); labels.air.center.set(-0.05, 0.5);
  device.parts.light.add(labels.light); labels.light.position.set(0.008, 0.03, 0); labels.light.center.set(-0.05, 0.5);
  device.parts.hat.add(labels.pi); labels.pi.position.set(0.026, 0.024, 0); labels.pi.center.set(-0.05, 0.5);
  device.parts.lcd.add(labels.lcd); labels.lcd.position.set(0.042, 0.04, 0); labels.lcd.center.set(-0.05, 0.5);
  device.parts.speaker.add(labels.speaker); labels.speaker.position.set(0.02, 0.016, 0); labels.speaker.center.set(-0.05, 0.5);

  const rig = new Rig(camera, [
    { T: 5.1, p: [1.25, 2.4, 7.6], t: [0, 1.9, 0], fov: 40 },
    { T: 5.4, p: [0.25, 1.72, 2.6], t: [0, 1.45, 0], fov: 40 },
    { T: 5.6, p: [0.0, 1.27, 0.55], t: [0, 1.22, -1.0], fov: 46 },
    { T: 5.7, p: [0.0, 1.24, -0.55], t: [0, 1.2, -3.0], fov: 50 },
    { T: 5.78, p: [-0.22, 1.24, -0.9], t: [-1.6, 1.15, -1.1], fov: 46 },
    { T: 5.87, p: [-0.42, 1.24, -1.16], t: [0.05, 1.08, -0.2], fov: 42 },
    { T: 5.97, p: [-0.3, 1.13, -0.82], t: [0.08, 0.98, -0.3], fov: 38 },
    { T: 6.1, p: [-0.4, 1.19, -0.8], t: [0.08, 1.0, -0.3], fov: 36 },
    { T: 6.3, p: [-0.2, 1.06, -0.56], t: [-0.03, 0.965, -0.33], fov: 30 },
    { T: 6.5, p: [0.02, 1.09, -0.52], t: [0.2, 0.99, -0.25], fov: 30 },
    { T: 6.7, p: [-0.12, 1.12, -0.6], t: [0.09, 0.955, -0.3], fov: 30 },
    { T: 6.88, p: [0.07, 1.05, -0.64], t: [0.1, 1.0, -0.39], fov: 30 },
    { T: 7.08, p: [-0.78, 1.42, -2.3], t: [0.12, 1.5, 0], fov: 38 },
    { T: 7.92, p: [-0.62, 1.36, -2.05], t: [0.1, 1.46, 0], fov: 38 },
    { T: 8.25, p: [0, 1.76, -3.0], t: [0, 1.8, 0], fov: 36 },
    { T: 9.0, p: [0, 1.8, -3.5], t: [0, 1.82, 0], fov: 34 },
  ], { parallax: 0.03 });

  // The device chapter frames the exploded device from an orbit (aspect-aware, so it also fits a phone):
  // [story T, part to favour (null = whole device), azimuth°, elevation°, share of the frame width]
  const DEV_BEATS = [[6.1, null, -30, 32, 0.6], [6.3, "air", -40, 27, 0.6], [6.5, "light", -14, 34, 0.6], [6.7, "pi", -26, 38, 0.58], [6.88, "lcd", -6, 26, 0.6], [7.0, "lcd", -6, 26, 0.6]];
  const devBox = new THREE.Box3(), devCentre = new THREE.Vector3(), devPart = {}, devCorners = [];
  {
    device.setExplode(1); device.root.updateMatrixWorld(true);
    for (const k of ["pi", "hat", "air", "light", "lcd", "speaker"]) {
      const b = new THREE.Box3().setFromObject(device.parts[k]); devBox.union(b); devPart[k] = b.getCenter(new THREE.Vector3());
      for (let c = 0; c < 8; c++) devCorners.push(new THREE.Vector3(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z));
    }
    devPart.pi.lerp(devPart.hat, 0.5); devPart.lcd.lerp(devPart.speaker, 0.45);
    devBox.getCenter(devCentre); device.setExplode(0);
  }
  const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _anchor = new THREE.Vector3(), _a2 = new THREE.Vector3();
  const devPos = new THREE.Vector3(), devTgt = new THREE.Vector3(), _c = new THREE.Vector3();
  function deviceCamera(T) {
    let i = 0; while (i < DEV_BEATS.length - 2 && T > DEV_BEATS[i + 1][0]) i++;
    const a = DEV_BEATS[i], b = DEV_BEATS[i + 1], s = smooth(clamp((T - a[0]) / (b[0] - a[0])));
    const az = THREE.MathUtils.degToRad(lerp(a[2], b[2], s)), el = THREE.MathUtils.degToRad(lerp(a[3], b[3], s)), fill = lerp(a[4], b[4], s);
    _anchor.copy(a[1] ? devPart[a[1]] : devCentre).lerp(devCentre, a[1] ? 0.45 : 0);
    _a2.copy(b[1] ? devPart[b[1]] : devCentre).lerp(devCentre, b[1] ? 0.45 : 0);
    _anchor.lerp(_a2, s);
    _dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    _fwd.copy(_dir).negate(); _right.crossVectors(_fwd, camera.up).normalize(); _up.crossVectors(_right, _fwd);
    const aspect = camera.aspect, wide = aspect > 1.1, vfov = 30, tanV = Math.tan(THREE.MathUtils.degToRad(vfov / 2)), tanH = tanV * aspect;
    // extent of the exploded parts seen from this direction (each part's own box, not the union's empty corners)
    let x0 = 1, x1 = -1, y0 = 1, y1 = -1, sd = 0;
    for (const p of devCorners) {
      _c.copy(p).sub(devCentre); const x = _c.dot(_right), y = _c.dot(_up);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sd = Math.max(sd, Math.abs(_c.dot(_fwd)));
    }
    const sx = (x1 - x0) / 2, sy = (y1 - y0) / 2;
    const fx = wide ? fill : 0.86;
    const d = Math.max(sx / (fx * tanH), sy / ((wide ? 0.66 : 0.4) * tanV)) + sd * 0.5;
    // where the favoured point sits on screen: right of the copy on wide screens, upper middle on phones
    const px = wide ? (a[1] || b[1] ? 0.63 : 0.66) : 0.5, py = wide ? 0.5 : 0.6;
    const shiftX = (px - 0.5) * 2 * d * tanH, shiftY = (py - 0.5) * 2 * d * tanV;
    devTgt.copy(_anchor).addScaledVector(_right, -shiftX).addScaledVector(_up, -shiftY);
    devPos.copy(devTgt).addScaledVector(_dir, d);
    return vfov;
  }

  const sunV = new THREE.Vector3(), sunColor = new THREE.Color(), fogClean = new THREE.Color(0xbac8d8), fogSmoke = new THREE.Color(0xb7835a);
  const cur = { t: 2.5, r: 1.2, m: 0.004, smoke: 0, el: 35, az: 200, cloud: 0 };
  let live = null, lastBeat = null;

  /** A sky from measurements: aerosol optical depth, sun elevation/azimuth (degrees), cloud cover 0..1.
   *  Cloud thickens the haze a little and takes most of the direct sun away. */
  function skyFrom({ aod = 0.15, el = 35, az = 200, cloud = 0 } = {}) {
    const c = clamp(cloud ?? 0);
    return [2 + aod * 12 + c * 4, clamp(1.5 - aod * 1.2 - c * 0.4, 0.3, 1.5), 0.003 + aod * 0.03 + c * 0.006, clamp((aod - 0.7) / 0.8), Math.max(el, -6), az, null, c];
  }
  // the real sky over PHS now
  const liveSky = () => skyFrom({ aod: live?.aod ?? 0.15, el: live?.sunElevation ?? 35, az: live?.sunAzimuth ?? 200, cloud: live?.cloud != null ? live.cloud / 100 : 0 });
  function liveKey() { return live?.verdict && LCD[live.verdict] ? live.verdict : "either"; }

  let skyEnvWait = 0, lastUpdate = -1;
  /** the sky's reflection map: rebuilt once the sky has settled, not while it moves (each rebuild is a
   *  ~80 ms frame on a laptop GPU; rebuilding every 0.25 s during a change was a visible stutter) */
  function updateSkyEnv(dt, moving) {
    skyEnvWait -= dt;
    if (moving && skyEnv) return;
    const key = [cur.t, cur.r, cur.m * 100, cur.smoke * 4, cur.el / 3, cur.az / 6].map((v) => Math.round(v * 2)).join(",");
    if (key === skyEnvKey || (skyEnv && skyEnvWait > 0)) return;
    skyEnvKey = key; skyEnvWait = 0.25;
    const prev = skyEnv;
    skyEnv = pmrem.fromScene(skyEnvScene, 0, 0.1, 1000);
    for (const m of kit.outdoor) { m.envMap = skyEnv.texture; m.needsUpdate = !prev; }
    if (prev) prev.dispose();
  }

  /** Put the camera at a pose {p, t, fov} (the live window drives the camera this way instead of story time). */
  function applyPose(pose) {
    camera.position.fromArray(pose.p); rig.target.fromArray(pose.t); camera.lookAt(rig.target);
    if (Math.abs(camera.fov - pose.fov) > 1e-3) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
  }

  // `drive` (live window): any field that is set replaces what story time would do
  //   { camera: {p, t, fov}, sky: {aod, el, az, cloud}, raise, explode, lcd: [l1, l2, rgb], near }
  function update(T, dt, time, hud, liveNow, sound, drive = null) {
    live = liveNow || live;
    if (drive?.camera) applyPose(drive.camera); else rig.apply(T, dt);
    // the device chapter: blend from the rig into the orbit framing and back out
    const dw = drive?.camera ? 0 : smooth(band(T, 5.97, 6.06, 6.92, 7.03));
    if (dw > 0.001) {
      const fov = deviceCamera(T);
      camera.position.lerp(devPos, dw); _c.copy(rig.target).lerp(devTgt, dw); camera.lookAt(_c);
      const f = lerp(camera.fov, fov, dw); if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); }
      room.focus.copy(_anchor);
    } else room.focus.set(0.1, win.sillTop + 0.03, -0.3);
    const dbg = window.__room;
    if (dbg && dbg.cam) { camera.position.fromArray(dbg.cam[0]); camera.lookAt(...dbg.cam[1]); if (dbg.cam[2]) { camera.fov = dbg.cam[2]; camera.updateProjectionMatrix(); } }
    const near = drive?.near ?? (T > 5.9 && T < 7.06 ? 0.004 : 0.03);
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }

    // which sky? live sky everywhere except the verdict chapter, which steps through four days
    const l7 = T - 7;
    let target = drive?.sky ? skyFrom(drive.sky) : T >= 8 ? liveSky() : SKY.intro, beat = null; // a fixed afternoon until the last chapter, which is live
    if (!drive?.sky && T >= 7 && T < 8) {
      for (const [k, a, b] of VERDICT_BEATS) if (l7 >= a - 0.02 && l7 < b + 0.02) beat = k;
      if (beat) target = SKY[beat];
    }
    // snap: arriving under a cloud (or back after another world was showing), no visible drift
    const snap = drive?.snap || time - lastUpdate > 0.3;
    lastUpdate = time;
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.2);
    const moving = Math.abs(cur.el - target[4]) > 0.6 || Math.abs(cur.t - target[0]) > 0.15 || Math.abs(cur.smoke - target[3]) > 0.03 || Math.abs(cur.az - target[5]) > 1.5;
    cur.t = lerp(cur.t, target[0], k); cur.r = lerp(cur.r, target[1], k); cur.m = lerp(cur.m, target[2], k);
    cur.smoke = lerp(cur.smoke, target[3], k); cur.el = lerp(cur.el, target[4], k); cur.az = lerp(cur.az, target[5], k);
    cur.cloud = lerp(cur.cloud, target[7] ?? 0, k);
    su.turbidity.value = cur.t; su.rayleigh.value = cur.r; su.mieCoefficient.value = cur.m;
    sunVector(cur.el, cur.az, sunV);
    su.sunPosition.value.copy(sunV);
    veil.material.uniforms.uAmt.value = cur.smoke;
    updateSkyEnv(dt, moving && !snap);
    const day = smooth(range(cur.el, -4, 8));
    sunColor.setRGB(1, lerp(0.95, 0.6, cur.smoke) * lerp(0.82, 1, smooth(range(cur.el, 4, 30))), lerp(0.88, 0.38, cur.smoke) * lerp(0.62, 1, smooth(range(cur.el, 4, 30))));
    const sunIntensity = (0.3 + 4.6 * day) * (1 - cur.smoke * 0.55) * (1 - cur.cloud * 0.65);
    scene.fog.color.copy(fogClean).lerp(fogSmoke, cur.smoke).multiplyScalar(0.25 + 0.75 * day);
    scene.fog.near = lerp(35, 9, cur.smoke); scene.fog.far = lerp(950, 190, cur.smoke) * lerp(1, 0.55, clamp((cur.t - 2.5) / 10));
    scene.environmentIntensity = 0.12 + 0.24 * day;
    room.update({ T, dt, time, sunV, sunIntensity, sunColor, day, smoke: cur.smoke, live });

    // glass reads as a reflection from outside and is barely there from inside
    const outside = smooth(range(camera.position.z, -0.1, 0.6));
    kit.mat.glass.opacity = lerp(0.07, 0.36, outside);
    kit.mat.glass.metalness = lerp(0.0, 0.5, outside);
    kit.mat.glass.color.setRGB(lerp(1, 0.5, outside), lerp(1, 0.56, outside), lerp(1, 0.62, outside));
    // a little more exposure once we're inside the room
    renderer.toneMappingExposure = lerp(0.62, 0.8, smooth(range(T, 5.55, 5.72))) * (1 + 0.25 * (1 - day));

    // sash
    let raise = 0;
    if (drive?.raise != null) raise = drive.raise;
    else if (T < 5.3) raise = 0;
    else if (T < 5.6) raise = 0.62 * easeInOut(range(T, 5.3, 5.55));
    else if (T < 6) raise = 0.62 * (1 - easeInOut(range(T, 5.88, 5.99)));
    else if (T < 7) raise = 0;
    else if (T < 8) { const r = beat ? SKY[beat][6] : 0; raise = lerp(win.raise, r, 1 - Math.exp(-dt * 4)); }
    else raise = lerp(win.raise, (SKY[liveKey()] || SKY.either)[6], 1 - Math.exp(-dt * 3));
    win.setRaise(raise);

    // exploded view (chapter 6)
    const e = drive?.explode ?? easeInOut(range(T, 5.98, 6.12)) * (1 - easeInOut(range(T, 6.94, 7.04)));
    device.setExplode(e);
    if (device.tick) device.tick(time);
    const show = (name, a, b) => (labels[name].element.style.opacity = band(T, a, a + 0.04, b - 0.04, b));
    show("air", 6.2, 6.42); show("light", 6.4, 6.62); show("pi", 6.6, 6.8); show("lcd", 6.8, 6.98); show("speaker", 6.8, 6.98);

    // LCD content
    if (drive?.lcd) device.setLCD(...drive.lcd);
    else if (beat) device.setLCD(...LCD[beat]);
    else {
      const key = liveKey(), [l1, l2a, rgb] = LCD[key];
      const aqi = live?.aqi != null ? String(Math.round(live.aqi)) : "?", st = live?.stale != null ? String(Math.round(live.stale)) : "?";
      const l2 = Math.floor(time / 4) % 2 ? `SkyAQI${aqi.padStart(4)} In${st.padStart(3)}` : l2a;
      device.setLCD(l1, l2, rgb);
    }
    if (beat !== lastBeat) { if (beat && sound) sound.chime(beat); lastBeat = beat; hud.verdict(beat); }

    // ventilate haze
    const vf = beat === "ventilate" ? 1 : 0;
    voc.material.opacity = lerp(voc.material.opacity, vf * 0.55, 1 - Math.exp(-dt * 3));
    voc.visible = voc.material.opacity > 0.01;
    if (voc.visible) {
      for (let i = 0; i < VN; i++) {
        const s = vSeed[i], p = (time * 0.12 + s) % 1;
        const s2 = (s * 7.31) % 1;
        vPos[i * 3] = lerp(-0.25 + s * 0.7, (s2 - 0.5) * 0.9, p) + Math.sin(time * 0.7 + s * 30) * 0.03;
        vPos[i * 3 + 1] = lerp(0.98 + s2 * 0.35, 1.0 + win.raise * 0.45 * s2, p) + Math.sin(time + s * 20) * 0.03;
        vPos[i * 3 + 2] = lerp(-0.35 - s2 * 0.7, 0.45, p);
      }
      vGeo.attributes.position.needsUpdate = true;
    }
    // voice rings (end of the verdict chapter)
    const vr = band(T, 7.8, 7.84, 7.97, 8.0);
    const spk = device.speaker.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.02, 0));
    rings.forEach((r, i) => {
      const p = (time * 0.6 + i / 3) % 1;
      r.visible = vr > 0.01; r.position.copy(spk); r.lookAt(camera.position);
      r.scale.setScalar(0.02 + p * 0.22); r.material.opacity = (1 - p) * 0.55 * vr;
    });
  }

  if (new URLSearchParams(location.search).has("roomdebug")) {
    window.__room = {
      scene, camera, renderer, room, kit, cur,
      stats() { // draw calls and triangles of one plain render (no shadow pass) from the current camera
        const info = renderer.info, auto = info.autoReset, sh = renderer.shadowMap.autoUpdate;
        const one = () => { info.reset(); renderer.setRenderTarget(null); renderer.render(scene, camera); return [info.render.calls, info.render.triangles]; };
        info.autoReset = false; renderer.shadowMap.autoUpdate = false;
        const [calls, triangles] = one();
        device.root.visible = false; const [roomCalls, roomTris] = one(); device.root.visible = true;
        renderer.shadowMap.autoUpdate = true; info.reset(); renderer.render(scene, camera); const withShadow = info.render.calls;
        info.autoReset = auto; renderer.shadowMap.autoUpdate = sh;
        return { calls, triangles, roomCalls, roomTris, withShadow };
      },
    };
  }

  // compile anything that arrived late so the first look inside doesn't stutter
  function upgrade() { if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {}); }

  /** where the camera is right now, as a pose (so a hand-off can start exactly here) */
  function pose() {
    return { p: camera.position.toArray(), t: rig.target.toArray(), fov: camera.fov };
  }

  return {
    scene, camera, update, upgrade, godrays: room.godrays, dof: room.dof,
    rig, win, device, kit, pose, skyFrom, labels, room,
    ao: tier === "low" ? null : { radius: 0.32, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 16 },
    exposure: 0.62, bloom: [0.2, 0.45, 0.92],
  };
}
