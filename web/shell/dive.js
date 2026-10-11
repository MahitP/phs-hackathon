// The dive from the story's first shot down to Princeton, in plain arrays (no three.js, so node can test it).
// Units: Earth radii, the story Earth's own scale (radius 1). Poses are { p: [x,y,z], t: [x,y,z], fov }.
const R_KM = 6371;
const D2R = Math.PI / 180;
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** horizontal field of view (degrees) for a vertical one and an aspect ratio */
export function hfov(vfovDeg, aspect) {
  return (2 * Math.atan(Math.tan((vfovDeg * D2R) / 2) * aspect)) / D2R;
}

/** ground width (km) across the screen for a camera at distance d from the centre, looking straight down */
export function groundWidthAt(d, vfovDeg, aspect) {
  const a = (hfov(vfovDeg, aspect) * D2R) / 2;
  // the screen edge's ray meets the sphere where sin(angle at the centre) = d·sin(a) (law of sines)
  const s = Math.min(1, d * Math.sin(a));
  const theta = Math.asin(s) - a; // the angle at the centre between straight down and the edge ray's hit
  return 2 * theta * R_KM;
}

/** distance from the centre at which the screen spans `km` of ground (the edge rays hit the sphere) */
export function distanceForGroundWidth(km, vfovDeg, aspect) {
  const a = (hfov(vfovDeg, aspect) * D2R) / 2, theta = km / (2 * R_KM);
  return Math.cos(theta) + Math.sin(theta) / Math.tan(a);
}

/** a camera above the surface point `dir` (unit vector) at distance `dist`, aiming at the ground */
export function lookPose(dir, dist, fov) {
  const n = norm(dir);
  return { p: n.map((x) => x * dist), t: n, fov };
}

/** between two poses: the direction on a great circle, the distance in log scale, the aim and fov linearly */
export function blendPose(a, b, k, out = { p: [0, 0, 0], t: [0, 0, 0], fov: 0 }) {
  const da = Math.hypot(...a.p), db = Math.hypot(...b.p);
  const ua = norm(a.p), ub = norm(b.p);
  const dot = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]));
  const om = Math.acos(dot), so = Math.sin(om);
  const wa = so < 1e-6 ? 1 - k : Math.sin((1 - k) * om) / so, wb = so < 1e-6 ? k : Math.sin(k * om) / so;
  const u = norm([ua[0] * wa + ub[0] * wb, ua[1] * wa + ub[1] * wb, ua[2] * wa + ub[2] * wb]);
  const d = Math.exp(Math.log(da) + (Math.log(db) - Math.log(da)) * k);
  for (let i = 0; i < 3; i++) { out.p[i] = u[i] * d; out.t[i] = a.t[i] + (b.t[i] - a.t[i]) * k; }
  out.fov = a.fov + (b.fov - a.fov) * k;
  return out;
}
