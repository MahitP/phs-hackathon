// A critically damped-ish spring stepped at a fixed rate, so it behaves the same at 30 or 120 fps.
// Used for things with mass: the sash, the time ruler's playhead.
export function createSpring({ value = 0, stiffness = 120, damping = 22, step = 1 / 240 } = {}) {
  let x = value, v = 0, target = value, acc = 0;
  return {
    get value() { return x; }, get velocity() { return v; }, get target() { return target; },
    set(t) { target = t; },
    jump(t) { x = target = t; v = 0; },
    settled(eps = 1e-4) { return Math.abs(x - target) < eps && Math.abs(v) < eps; },
    update(dt) {
      acc += Math.min(dt, 0.1);
      while (acc >= step) { acc -= step; v += (stiffness * (target - x) - damping * v) * step; x += v * step; }
      return x;
    },
  };
}
