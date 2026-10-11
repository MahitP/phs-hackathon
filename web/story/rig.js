// Camera rig: keyframes on story time T, interpolated with a cubic Hermite spline whose tangents
// come from the neighbouring keys (velocity stays continuous through uneven key spacing). A key that
// repeats its neighbour becomes a hold. Same idea as edolus's CameraController, in three.js.
import * as THREE from "three";
import { damp } from "./util.js";
import { viewport } from "../shell/viewport.js";

export class Rig {
  /** keys: [{ T, p: [x,y,z], t: [x,y,z], fov }] sorted by T */
  constructor(camera, keys, { parallax = 0 } = {}) {
    this.camera = camera;
    this.keys = keys.map((k) => ({ T: k.T, v: [...k.p, ...k.t, k.fov ?? camera.fov] }));
    this.parallax = parallax;
    this.mouse = new THREE.Vector2();
    this.smoothMouse = new THREE.Vector2();
    this.target = new THREE.Vector3();
    this._tan = this.keys.map((k, i) => {
      const a = this.keys[Math.max(0, i - 1)], b = this.keys[Math.min(this.keys.length - 1, i + 1)];
      const same = (x, y) => x.v.every((val, j) => Math.abs(val - y.v[j]) < 1e-6);
      if (b.T === a.T || same(a, k) || same(k, b)) return k.v.map(() => 0);
      return k.v.map((_, j) => (b.v[j] - a.v[j]) / (b.T - a.T));
    });
    this._out = new Array(7).fill(0);
    window.addEventListener("pointermove", (e) => this.mouse.set(e.clientX / viewport.w * 2 - 1, e.clientY / viewport.h * 2 - 1));
  }

  sample(T) {
    const k = this.keys, o = this._out;
    if (T <= k[0].T) { k[0].v.forEach((v, j) => (o[j] = v)); return o; }
    const last = k[k.length - 1];
    if (T >= last.T) { last.v.forEach((v, j) => (o[j] = v)); return o; }
    let i = 0;
    while (i < k.length - 2 && T > k[i + 1].T) i++;
    const a = k[i], b = k[i + 1], ta = this._tan[i], tb = this._tan[i + 1];
    const d = b.T - a.T, s = (T - a.T) / d, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    for (let j = 0; j < 7; j++) o[j] = h00 * a.v[j] + h10 * d * ta[j] + h01 * b.v[j] + h11 * d * tb[j];
    return o;
  }

  apply(T, dt) {
    const o = this.sample(T), cam = this.camera;
    this.smoothMouse.x = damp(this.smoothMouse.x, this.mouse.x, 2.5, dt);
    this.smoothMouse.y = damp(this.smoothMouse.y, this.mouse.y, 2.5, dt);
    cam.position.set(o[0], o[1], o[2]);
    this.target.set(o[3], o[4], o[5]);
    if (Math.abs(cam.fov - o[6]) > 1e-3) { cam.fov = o[6]; cam.updateProjectionMatrix(); }
    cam.lookAt(this.target);
    if (this.parallax && matchMedia("(pointer: fine)").matches) {
      const dist = cam.position.distanceTo(this.target), amt = this.parallax * dist;
      cam.translateX(this.smoothMouse.x * amt);
      cam.translateY(-this.smoothMouse.y * amt * 0.6);
      cam.lookAt(this.target);
    }
  }
}
