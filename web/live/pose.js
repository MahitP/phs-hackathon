// Camera poses for the live window and how to move between them.
// A pose is { p: [x, y, z], t: [x, y, z] look-at target, fov }. Room coordinates are metres:
// the window opening runs x -0.6..0.6, y 0.92..2.72 in the wall at z = 0; the room is z < 0.

/** The live window: the sash, the sky in it and the device on the sill, seen from the classroom. */
export const LIVE_POSE = { p: [-0.56, 1.5, -2.95], t: [0.06, 1.52, 0], fov: 38 };
/** Portrait screens: further back and higher, the window in the top half. */
export const LIVE_POSE_TALL = { p: [-0.1, 1.72, -3.9], t: [0.0, 1.38, 0], fov: 48 };
/** Inspecting the device on the sill (0.1, 0.92, -0.3). */
export const INSPECT_POSE = { p: [-0.18, 1.12, -0.74], t: [0.1, 0.98, -0.3], fov: 32 };

/** How far the picture moves right to clear the left column, in CSS px (0 on narrow screens). */
export function liveShift(w, h) {
  if (w / h < 1.1) return { x: 0, y: 0 };
  return { x: Math.round(Math.min(0.25 * w, 420)), y: 0 };
}
export const livePose = (w, h) => (w / h < 1.1 ? LIVE_POSE_TALL : LIVE_POSE);

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t, o = [0, 0, 0]) => { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); return o; };

/** Blend two poses; `arc` lifts the path sideways in the middle so it reads as a move, not a zoom. */
export function blendPose(a, b, t, arc = [0, 0, 0], out = { p: [0, 0, 0], t: [0, 0, 0], fov: 0 }) {
  lerp3(a.p, b.p, t, out.p);
  const bump = Math.sin(Math.PI * t);
  out.p[0] += arc[0] * bump; out.p[1] += arc[1] * bump; out.p[2] += arc[2] * bump;
  lerp3(a.t, b.t, t, out.t);
  out.fov = lerp(a.fov, b.fov, t);
  return out;
}

export const clonePose = (p) => ({ p: [...p.p], t: [...p.t], fov: p.fov });
