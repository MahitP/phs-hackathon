// web/shell/rewind.js: the tape rewind's timing, its speed and what the counter shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rewindDuration, rewindT, speedAt, tapeCounter, chapterAt } from "../../web/shell/rewind.js";

test("the whole story rewinds in under three seconds; a short way back is quicker; from the start there is none", () => {
  const full = rewindDuration(8.5);
  assert.ok(full >= 2.4 && full <= 3, `from the end: ${full}`);
  assert.ok(rewindDuration(1) < full && rewindDuration(1) >= 0.8, `from T 1: ${rewindDuration(1)}`);
  assert.equal(rewindDuration(0.2), 0, "already at the first shot");
});

test("story time runs from where you were back to exactly 0, never overshooting", () => {
  const T0 = 8.5, D = rewindDuration(T0);
  assert.equal(rewindT(0, T0, D), T0);
  assert.equal(rewindT(D, T0, D), 0);
  assert.equal(rewindT(D + 1, T0, D), 0);
  let prev = T0;
  for (let t = 0; t <= D; t += D / 200) {
    const T = rewindT(t, T0, D);
    assert.ok(T <= prev + 1e-9 && T >= 0, `monotonic at t ${t}: ${T}`);
    prev = T;
  }
});

test("the tape spins up, runs fast, and is still moving when it clunks to a stop", () => {
  const T0 = 8.5, D = rewindDuration(T0);
  const start = speedAt(0.02, T0, D), mid = speedAt(D / 2, T0, D), end = speedAt(D - 0.01, T0, D);
  assert.ok(start < mid * 0.3, `slow at first: ${start} vs ${mid}`);
  assert.ok(end > mid * 0.2 && end < mid, `still turning at the clunk: ${end} vs ${mid}`);
  // the speed integrates to the distance covered
  let sum = 0; const n = 2000;
  for (let i = 0; i < n; i++) sum += speedAt((i + 0.5) * D / n, T0, D) * D / n;
  assert.ok(Math.abs(sum - T0) < 0.01, `integral ${sum}`);
});

test("the counter reads story time as a tape counter", () => {
  assert.equal(tapeCounter(8.5), "00:08:30");
  assert.equal(tapeCounter(0), "00:00:00");
  assert.equal(tapeCounter(2.999), "00:02:59");
  assert.equal(tapeCounter(-0.1), "00:00:00");
});

test("the chapter name follows story time", () => {
  const names = ["Orbit", "The air", "Descent"];
  assert.equal(chapterAt(0, names), "Orbit");
  assert.equal(chapterAt(1.5, names), "The air");
  assert.equal(chapterAt(9, names), "Descent");
  assert.equal(chapterAt(-1, names), "Orbit");
});
