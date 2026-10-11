// web/model/ventilation.js: what opening the sash would do (CIBSE AM10 single-sided ventilation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { airflow, projectIndex, minutesToFresh, indoorPM, ROOM_VOLUME } from "../../web/model/ventilation.js";

test("the classroom's volume comes from its real dimensions (9 x 8.45 x 3 m)", () => {
  assert.ok(Math.abs(ROOM_VOLUME - 228.15) < 0.01);
});

test("a shut sash moves no air", () => {
  const a = airflow({ raise: 0, windKmh: 20, tOutC: 5 });
  assert.equal(a.q, 0);
  assert.equal(a.ach, 0);
});

test("more opening and more wind both move more air", () => {
  const small = airflow({ raise: 0.1, windKmh: 10, tOutC: 15 }).ach;
  const big = airflow({ raise: 0.5, windKmh: 10, tOutC: 15 }).ach;
  const windy = airflow({ raise: 0.1, windKmh: 30, tOutC: 15 }).ach;
  assert.ok(big > small, `${big} > ${small}`);
  assert.ok(windy > small, `${windy} > ${small}`);
});

test("with no wind, a temperature difference still drives air (stack effect)", () => {
  const still = airflow({ raise: 0.3, windKmh: 0, tOutC: 5 });
  assert.equal(still.qWind, 0);
  assert.ok(still.qStack > 0);
  assert.equal(airflow({ raise: 0.3, windKmh: 0, tOutC: 21 }).q, 0, "no wind and no temperature difference: no flow");
});

test("wind and stack add in quadrature", () => {
  const a = airflow({ raise: 0.3, windKmh: 12, tOutC: 9 });
  assert.ok(Math.abs(a.q - Math.hypot(a.qWind, a.qStack)) < 1e-12);
  // CIBSE AM10: Qw = 0.025 A U, A = 1.05 m x raise, U in m/s
  assert.ok(Math.abs(a.qWind - 0.025 * 1.05 * 0.3 * (12 / 3.6)) < 1e-12);
});

test("the stale index relaxes toward the room's steady state", () => {
  const shut = projectIndex({ idx0: 30, ach: 0, minutes: 600 });
  const open = projectIndex({ idx0: 30, ach: 3, minutes: 600 });
  assert.ok(shut > 30, "a shut, occupied room keeps getting staler");
  assert.ok(open < 30, "an open window clears it");
  assert.equal(projectIndex({ idx0: 30, ach: 3, minutes: 0 }), 30);
  assert.ok(projectIndex({ idx0: 30, ach: 3, minutes: 1e6 }) >= 0);
});

test("minutes to fresh: 0 when already fresh, null when it never gets there, shorter with more air", () => {
  assert.equal(minutesToFresh({ idx0: 10, ach: 1 }), 0);
  assert.equal(minutesToFresh({ idx0: 50, ach: 0 }), null);
  const slow = minutesToFresh({ idx0: 50, ach: 1 }), fast = minutesToFresh({ idx0: 50, ach: 4 });
  assert.ok(slow > fast && fast > 0, `${slow} > ${fast} > 0`);
});

test("smoky outside air raises indoor PM2.5 the more the sash is open", () => {
  const shut = indoorPM({ cOut: 80, ach: 0, minutes: 60 });
  const open = indoorPM({ cOut: 80, ach: 2, minutes: 60 });
  assert.ok(open > shut, `${open} > ${shut}`);
  assert.ok(indoorPM({ cOut: 80, ach: 50, minutes: 1e5 }) < 80 * 0.9 + 1e-9, "never above what gets through");
});
