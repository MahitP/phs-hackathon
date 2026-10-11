// The tape rewind's clock: how long it takes, where story time is at each moment, how fast the tape
// turns (for the picture's tracking noise and the motor's pitch), and what the counter reads.
// The tape spins up, runs at full speed, slows a little, and is still moving when it clunks to a stop.
const SPIN_UP = 0.12, SLOW = 0.08, END_SPEED = 0.45; // fractions of the run; speed left at the clunk (of full)

/** seconds to rewind from story time T0 (0 when already at the first shot) */
export function rewindDuration(T0) {
  if (!(T0 >= 0.3)) return 0;
  return Math.min(2.8, Math.max(0.8, 0.8 + (T0 / 8.5) * 2.0));
}

// relative speed over the run u in 0..1, and its integral (closed form; linear ramps)
const speedRel = (u) => (u < SPIN_UP ? u / SPIN_UP : u <= 1 - SLOW ? 1 : 1 - (1 - END_SPEED) * (u - (1 - SLOW)) / SLOW);
function covered(u) {
  if (u <= 0) return 0;
  if (u < SPIN_UP) return (u * u) / (2 * SPIN_UP);
  if (u <= 1 - SLOW) return SPIN_UP / 2 + (u - SPIN_UP);
  const d = Math.min(u, 1) - (1 - SLOW);
  return SPIN_UP / 2 + (1 - SLOW - SPIN_UP) + d - ((1 - END_SPEED) * d * d) / (2 * SLOW);
}
const TOTAL = covered(1);

/** story time t seconds into a rewind of duration D that started at T0 */
export function rewindT(t, T0, D) {
  if (!(D > 0) || t >= D) return 0;
  if (t <= 0) return T0;
  return Math.max(0, T0 * (1 - covered(t / D) / TOTAL));
}

/** how fast story time is running backwards (story units per second) */
export function speedAt(t, T0, D) {
  if (!(D > 0) || t < 0 || t > D) return 0;
  return (T0 * speedRel(t / D)) / TOTAL / D;
}

/** story time as a tape counter: T 8.5 reads 00:08:30 */
export function tapeCounter(T) {
  const s = Math.max(0, Math.floor(T * 60 + 1e-9));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** the chapter shown at story time T */
export function chapterAt(T, names) {
  return names[Math.min(names.length - 1, Math.max(0, Math.floor(T)))] || "";
}
