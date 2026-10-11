// web/shell/dive.js: the camera's flight from the story's first shot down to Princeton, and the height
// at which the story's Earth shows the same ground as the app's map at zoom 6.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hfov, groundWidthAt, distanceForGroundWidth, lookPose, blendPose } from "../../web/shell/dive.js";

const len = (v) => Math.hypot(...v);
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("horizontal field of view from the vertical one", () => {
  assert.ok(close(hfov(30, 1), 30));
  assert.ok(hfov(30, 16 / 9) > 30 && hfov(30, 16 / 9) < 60);
});

test("the camera height for a ground width is the inverse of the ground width at a height", () => {
  for (const km of [400, 1500, 2700, 5000]) {
    const d = distanceForGroundWidth(km, 30, 1.6);
    assert.ok(d > 1, `outside the planet for ${km} km: ${d}`);
    assert.ok(close(groundWidthAt(d, 30, 1.6), km, 1e-6), `round trip ${km}`);
  }
  // wider ground needs a higher camera
  assert.ok(distanceForGroundWidth(2700, 30, 1.6) > distanceForGroundWidth(1500, 30, 1.6));
});

test("a look-down pose sits above the point and aims at the surface", () => {
  const dir = [0, 0.6, 0.8], p = lookPose(dir, 1.4, 30);
  assert.ok(close(len(p.p), 1.4));
  assert.ok(close(len(p.t), 1));
  assert.equal(p.fov, 30);
});

test("blending poses starts and ends exactly on them and never dips inside the planet", () => {
  const a = { p: [-0.55, 0.55, 5.9], t: [-1.08, 0.12, 0], fov: 34 };
  const b = lookPose([0.3, 0.64, -0.7].map((x, _, v) => x / len(v)), 1.43, 30);
  const out = { p: [0, 0, 0], t: [0, 0, 0], fov: 0 };
  const at0 = blendPose(a, b, 0, out);
  assert.deepEqual(at0.p.map((x) => +x.toFixed(9)), a.p);
  assert.deepEqual(at0.t.map((x) => +x.toFixed(9)), a.t);
  const at1 = blendPose(a, b, 1, out);
  b.p.forEach((x, i) => assert.ok(close(at1.p[i], x), `end p[${i}]`));
  b.t.forEach((x, i) => assert.ok(close(at1.t[i], x), `end t[${i}]`));
  for (let k = 0; k <= 1; k += 0.01) {
    const d = len(blendPose(a, b, k, out).p);
    assert.ok(d >= 1.43 - 1e-9, `k ${k}: distance ${d}`);
  }
});

test("the distance falls off evenly in log scale (it slows near the ground, like a real descent)", () => {
  const a = lookPose([0, 0, 1], 8, 30), b = lookPose([0, 0, 1], 2, 30), out = { p: [0, 0, 0], t: [0, 0, 0], fov: 0 };
  assert.ok(close(len(blendPose(a, b, 0.5, out).p), 4, 1e-9));
});
